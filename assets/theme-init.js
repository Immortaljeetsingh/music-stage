/* Runs in <head> before the body renders: stored appearance, Simple mode and glass level apply on the
   first paint, so the page never flashes the wrong theme or re-flows when the full scripts load. */
(()=>{
  const root=document.documentElement;
  let appearance='',experience='advanced',glass=65;
  try{
    appearance=localStorage.getItem('appearance')||'';
    experience=localStorage.getItem('experience')||'advanced';
    const stored=localStorage.getItem('glass');if(stored!=null&&stored!==''&&Number.isFinite(+stored))glass=+stored;
  }catch(_){}
  if(appearance!=='light'&&appearance!=='dark')appearance=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';
  root.dataset.appearance=appearance;root.style.colorScheme=appearance;
  root.dataset.experience=experience==='simple'?'simple':'advanced';
  const level=Math.max(0,Math.min(100,glass))/100;
  root.style.setProperty('--glass-opacity-scale',(.55+.45*level).toFixed(3));
  root.style.setProperty('--glass-blur-scale',(.45+1.1*level).toFixed(3));
  const themeColor=document.querySelector('meta[name=theme-color]');
  if(themeColor)themeColor.content=appearance==='light'?'#f2f2f7':'#0a0a0c';
})();
