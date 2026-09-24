const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {chromium}=require('playwright');
// UI contract: iOS 27 shell (glass cards, tab bar with Prominent Tab on phones, 44pt targets),
// panel reachability, preset wiring, furniture drag via mouse + real touch, no overflow 320-1280,
// Light + Dark appearances, Liquid Glass transparency slider.
(async()=>{
  const browser=await chromium.launch(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'});
  const hasTabs=page=>page.evaluate(()=>getComputedStyle(document.querySelector('.tabbar')).display!=='none');
  const go=async(page,t)=>{if(await hasTabs(page))await page.locator('.tab[data-tab='+t+']').click();};
  try{
    for(const width of [320,390,768,1280]){
      const page=await browser.newPage({viewport:{width,height:900},hasTouch:true});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);
      const tabs=await hasTabs(page);
      assert.equal(tabs,width<900,'tab bar shown only on phone/tablet widths, at '+width);
      assert.equal(await page.locator('.tabbar .tab').count(),5,'five tabs at '+width);
      // every panel reachable, and its primary control actually visible
      const KEYS={stage:'#play',source:'#loadDemo',room:'#addBed',rig:'#addSp',sound:'#tL'};
      for(const [t,sel] of Object.entries(KEYS)){
        await go(page,t);
        assert(await page.locator(sel).isVisible(),t+' panel exposes '+sel+' at '+width);
      }
      // Liquid Glass transparency slider drives the material scale
      await go(page,'stage');
      const g0=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--glass-opacity-scale'));
      await page.evaluate(()=>{const g=$('glassAmt');g.value=0;g.dispatchEvent(new Event('input'));});
      const g1=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--glass-opacity-scale'));
      assert(g0!==g1,'glass slider changes material opacity at '+width);
      await page.evaluate(()=>{const g=$('glassAmt');g.value=65;g.dispatchEvent(new Event('input'));});
      // furniture: add in Room, drag on the Stage canvas, read fields back in Room
      for(const [type,id] of [['Bed','addBed'],['Sofa','addSofa'],['Wardrobe','addWardrobe']]){
        await go(page,'room');
        await page.locator('#'+id).click();
        await page.evaluate(()=>{sps.forEach(s=>s.x=5);listener.x=5;draw();});
        await go(page,'stage');
        await page.locator('#c').scrollIntoViewIfNeeded();
        const session=await page.context().newCDPSession(page);
        for(const touch of [false,true]){
          await page.evaluate(()=>{furniture[0].x=0;furniture[0].y=0;showFurniture();draw();});
          const pos=await page.evaluate(()=>{const r=c.getBoundingClientRect(),o=furniture[0],[x,y]=P3(o.x+o.w/2,o.y+o.d/2,o.h);return {x:r.left+x*r.width/c.width,y:r.top+y*r.height/c.height};});
          if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...pos,id:1}]});
          else{await page.mouse.move(pos.x,pos.y);await page.mouse.down();}
          assert.equal(await page.evaluate(()=>drag?.t),'f',type+' visible top selected');
          assert.deepEqual(await page.evaluate(()=>({x:furniture[0].x,y:furniture[0].y})),{x:0,y:0},'no jump on pointer down');
          for(let i=1;i<=6;i++){
            const point={x:pos.x+60*i/6,y:pos.y+20*i/6};
            if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,id:1}]});
            else await page.mouse.move(point.x,point.y);
          }
          if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();
          const after=await page.evaluate(t=>{const f=furniture[0];return {x:f.x,y:f.y,w:f.w,d:f.d,field:document.querySelector('input[aria-label="'+t+' X"]')?.value};},type);
          assert(after.x>0.1&&after.y>0.1,type+' moved at '+width);
          assert(after.x+after.w<=6&&after.y+after.d<=8,type+' within bounds at '+width);
          assert.equal(after.field,String(after.x),'coordinate control synced at '+width);
        }
        await go(page,'room');
        await page.getByRole('button',{name:'Remove '+type,exact:true}).click();
      }
      // presets apply their exact control values; manual tweak returns selector to Custom
      await go(page,'room');
      const presets=await page.evaluate(()=>Object.keys(PRESETS));
      assert(presets.length>=6,'presets present: '+presets.length);
      for(const name of presets){
        await page.selectOption('#preset',name);
        const applied=await page.evaluate(()=>({walls:$('walls').checked,abs:+$('wallAbs').value,verb:+$('roomAmt').value,furn:$('furn').value,air:$('air').checked,expect:PRESETS[$('preset').value]}));
        assert.deepEqual({walls:applied.walls,abs:applied.abs,verb:applied.verb,furn:applied.furn,air:applied.air},applied.expect,name+' applied at '+width);
      }
      await page.evaluate(()=>{const el=$('wallAbs');el.value=0.6;el.dispatchEvent(new Event('input'));});
      assert.equal(await page.evaluate(()=>$('preset').value),'','manual tweak resets preset');
      // layout guarantees
      for(const t of ['stage','source','room','rig','sound']){
        await go(page,t);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no overflow in '+t+' at '+width);
        const small=await page.evaluate(()=>{const bad=[];
          for(const el of document.querySelectorAll('button,select,input:not([type=range]),summary')){
            const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden')continue;
            const r=el.getBoundingClientRect();if(!r.width&&!r.height)continue;
            if(r.right>innerWidth+1||r.left<-1){bad.push('offscreen '+(el.id||el.textContent||el.tagName).slice(0,14));continue;}
            if(el.type==='checkbox'){const lb=el.closest('label');if(lb&&lb.getBoundingClientRect().height<40){bad.push('switch '+(el.id||'?'));}continue;}
            if(r.height<40&&!el.closest('ol')&&!el.closest('#res'))bad.push('tap '+(el.id||el.textContent||el.tagName).slice(0,14)+':'+Math.round(r.height));
          }return bad;});
        assert.deepEqual(small,[],'44pt targets in '+t+' at '+width+(small.length?' -> '+small.join(', '):''));
      }
      // sticky column must fit the viewport on wide screens, else its bottom is unreachable
      assert(await page.evaluate(()=>{const c=document.querySelector('.col-stage');return getComputedStyle(c).position!=='sticky'||c.getBoundingClientRect().height<=innerHeight+1;}),'sticky col fits viewport at '+width);
      assert.deepEqual(errors,[],'no browser errors at '+width);
      await page.close();
    }
    // Light + Dark: both appearances render and stay inside the viewport
    const seen={};
    for(const scheme of ['dark','light']){
      const page=await browser.newPage({viewport:{width:390,height:844},colorScheme:scheme,hasTouch:true});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);
      seen[scheme]=await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no overflow in '+scheme);
      assert.deepEqual(errors,[]);
      await page.close();
    }
    assert.notEqual(seen.dark,seen.light,'system appearance changes the palette');
    console.log('PASS: iOS 27 shell — glass cards, tabs+prominent tab on phones, 44pt targets, panels reachable, presets, drag, light/dark, 320-1280.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
