(() => {
  const frame=document.getElementById('codex-visualization');
  let preview=null;
  window.addEventListener('message',event=>{
    if(event.source!==frame.contentWindow||event.data?.type!=='wedding-png-preview')return;
    const png=event.data.png;
    if(typeof png!=='string'||png.length>24*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(png))return;
    preview?.remove();
    preview=document.createElement('div');preview.setAttribute('role','dialog');preview.setAttribute('aria-modal','true');preview.setAttribute('aria-label','导出长图预览');
    preview.style.cssText='position:fixed;inset:0;z-index:10000;overflow:auto;background:light-dark(#fff,#191919);color:light-dark(#222,#eee);padding:16px;box-sizing:border-box;';
    const bar=document.createElement('div');bar.style.cssText='position:sticky;top:-16px;background:inherit;display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 0;max-width:800px;margin:auto;';
    const download=document.createElement('a');download.textContent='保存 PNG 图片';download.download='婚礼筹备时间线.png';download.href=png;download.style.cssText='color:inherit;min-height:44px;display:inline-flex;align-items:center;padding:0 16px;border:1px solid currentColor;border-radius:8px;text-decoration:none;';
    const close=document.createElement('button');close.type='button';close.textContent='关闭预览';close.style.cssText='font:inherit;color:inherit;background:transparent;min-height:44px;padding:0 16px;border:1px solid currentColor;border-radius:8px;';
    const help=document.createElement('span');help.textContent='手机也可长按图片保存';
    const img=document.createElement('img');img.src=png;img.alt='婚礼筹备时间线完整长图';img.style.cssText='display:block;width:100%;max-width:800px;height:auto;margin:12px auto;';
    const priorOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
    const dismiss=()=>{preview?.remove();preview=null;document.body.style.overflow=priorOverflow;document.removeEventListener('keydown',onKey);};
    const onKey=e=>{if(e.key==='Escape')dismiss();if(e.key==='Tab'){if(e.shiftKey&&document.activeElement===download){e.preventDefault();close.focus();}else if(!e.shiftKey&&document.activeElement===close){e.preventDefault();download.focus();}}};
    close.addEventListener('click',dismiss);document.addEventListener('keydown',onKey);
    bar.append(download,close,help);preview.append(bar,img);document.body.append(preview);download.focus();
  });
})();
