const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'});
  try{
    for(const width of [390,1280]){
      const page=await browser.newPage({viewport:{width,height:900},hasTouch:true});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);
      const session=await page.context().newCDPSession(page);
      for(const [type,id] of [['Bed','addBed'],['Sofa','addSofa'],['Wardrobe','addWardrobe']]){
        await page.locator('#'+id).click();
        await page.evaluate(()=>{sps.forEach(s=>s.x=5);listener.x=5;draw();});
        await page.locator('#c').scrollIntoViewIfNeeded();
        for(const touch of [false,true]){
          await page.evaluate(()=>{furniture[0].x=0;furniture[0].y=0;showFurniture();draw();});
          const pos=await page.evaluate(()=>{const r=c.getBoundingClientRect(),o=furniture[0],[x,y]=P3(o.x+o.w/2,o.y+o.d/2,o.h);return {x:r.left+x*r.width/c.width,y:r.top+y*r.height/c.height};});
          if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...pos,id:1}]});
          else{await page.mouse.move(pos.x,pos.y);await page.mouse.down();}
          assert.equal(await page.evaluate(()=>drag?.t),'f',type+' visible top selected');
          const before=await page.evaluate(()=>({x:furniture[0].x,y:furniture[0].y}));
          assert.deepEqual(before,{x:0,y:0},'no jump on pointer down');
          for(let i=1;i<=6;i++){
            const point={x:pos.x+60*i/6,y:pos.y+20*i/6};
            if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,id:1}]});
            else await page.mouse.move(point.x,point.y);
          }
          if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();
          const after=await page.evaluate(()=>({x:furniture[0].x,y:furniture[0].y,w:furniture[0].w,d:furniture[0].d}));
          assert(after.x>0.1&&after.y>0.1,type+' moved');
          assert(after.x+after.w<=6&&after.y+after.d<=8,type+' within bounds');
          assert.equal(await page.getByLabel(type+' X',{exact:true}).inputValue(),String(after.x),'coordinate control updated');
        }
        await page.getByRole('button',{name:'Remove '+type,exact:true}).click();
      }
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no overflow');
      assert.deepEqual(errors,[],'no browser errors');
      await page.close();
    }
    console.log('PASS: mouse and real touch dragging for bed, sofa, wardrobe on mobile and desktop; bounds, coordinates and layout.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
