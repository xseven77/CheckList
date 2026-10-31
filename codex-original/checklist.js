(() => {
  const root = document.getElementById('wedding-timeline');
  if (!root) return;
  const style = document.createElement('style');
  style.textContent = `
    #wedding-timeline .item-checkbox {appearance:auto;width:18px;height:18px;flex-shrink:0;vertical-align:middle;margin:0 8px 0 0;accent-color:var(--foreground)}
    #wedding-timeline .item-label {display:flex;align-items:baseline}
    #wedding-timeline .check-items {display:grid;gap:6px;min-width:0}
    #wedding-timeline .check-row {display:flex;align-items:flex-start;gap:6px;min-width:0}
    #wedding-timeline .check-row label {flex:1;min-width:0;overflow-wrap:anywhere}
    #wedding-timeline .check-row input:checked + span {text-decoration:line-through;color:var(--muted-foreground)}
    #wedding-timeline .add-form {display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
    #wedding-timeline .add-form input {flex:1;min-width:110px}
    #wedding-timeline .edit-status {display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:10px}
    #wedding-timeline .task-label {display:flex;gap:8px;align-items:baseline}
    #wedding-timeline .check-row .btn {flex-shrink:0}
    #wedding-timeline:not(.editing) .edit-only {display:none!important}
    #wedding-timeline .item-label,#wedding-timeline .task-label {min-height:36px;align-items:center}
    #wedding-timeline .check-row {flex-wrap:wrap;align-items:center}
    #wedding-timeline .confirm-delete {width:100%;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 0}
    #wedding-timeline .confirm-delete span {width:100%}
    #wedding-timeline .item-editor {flex:1;min-width:120px}
    @media(pointer:coarse),(max-width:500px){
      #wedding-timeline button,#wedding-timeline summary {min-height:44px}
      #wedding-timeline .item-label,#wedding-timeline .task-label {min-height:44px}
      #wedding-timeline .item-checkbox {width:22px;height:22px}
      #wedding-timeline input[type=text] {font-size:16px;min-height:44px}
      #wedding-timeline .check-row label {flex-basis:100%}
      #wedding-timeline .group {grid-template-columns:1fr;gap:2px}
    }
  `;
  root.append(style);
  const intro = root.querySelector('.intro');
  intro.querySelector('p').textContent = '查看模式可勾选 · 编辑模式可管理明细 · 记录仅保存在当前浏览器';
  const toolbar=document.createElement('div');toolbar.className='edit-status';
  const toggle=document.createElement('button');toggle.type='button';toggle.className='btn btn-primary';toggle.textContent='编辑';toggle.setAttribute('aria-pressed','false');
  const mode=document.createElement('span');mode.textContent='查看状态';
  const exportButton=document.createElement('button');exportButton.type='button';exportButton.className='btn';exportButton.textContent='导出长图';
  toolbar.append(mode,toggle,exportButton);intro.append(toolbar);
  toggle.addEventListener('click',()=>{
    const editing=root.classList.toggle('editing');
    toggle.textContent=editing?'完成编辑':'编辑';toggle.setAttribute('aria-pressed',String(editing));mode.textContent=editing?'编辑状态':'查看状态';
    if(!editing)groups.forEach(render);
  });
  const status = document.createElement('div');
  status.className = 'edit-status';
  const progress = document.createElement('span');
  const saveStatus = document.createElement('span');
  saveStatus.className = 'text-small text-muted';
  saveStatus.setAttribute('role','status');
  saveStatus.textContent = '修改仅保存在当前浏览器';
  const undo = document.createElement('button');
  undo.type = 'button'; undo.className = 'btn btn-ghost edit-only'; undo.textContent = '撤销删除'; undo.disabled = true;
  status.append(progress,saveStatus,undo);intro.append(status);
  const groups = [];
  const tasks = [];
  let deletion = null;
  let revision = 0;
  let appliedSignature = '';
  let sequence = 0;
  function snapshot() {
    return {v:1, tasks:tasks.map(t=>t.checked),groups:groups.map(g=>g.items.map(i=>[i.text,i.done?1:0]))};
  }
  function updateCount() {
    const items=groups.flatMap(g=>g.items);
    progress.textContent=`事项 ${tasks.filter(t=>t.checked).length}/${tasks.length} · 明细 ${items.filter(i=>i.done).length}/${items.length}`;
  }
  function stateFor(value) { return {modelContent:null,privateContent:{weddingChecklist:value}}; }
  function canFit(value) { return new TextEncoder().encode(JSON.stringify(stateFor(value))).length < 15500; }
  async function save() {
    updateCount();
    const state = snapshot(); const current = ++revision;
    appliedSignature=JSON.stringify(state);
    saveStatus.textContent='保存中…';
    try {
      if (!canFit(state)) throw Error('limit');
      if (!window.openai?.setWidgetState) throw Error('unavailable');
      await window.openai.setWidgetState(stateFor(state));
      if(current===revision) saveStatus.textContent='已保存到当前浏览器';
    } catch {
      if(current===revision) saveStatus.textContent='未能保存，请勿关闭本页；可检查浏览器存储权限';
    }
  }
  function render(g) {
    g.list.replaceChildren();
    g.items.forEach((item,index)=>{
      const row=document.createElement('div');row.className='check-row';
      const label=document.createElement('label');label.className='item-label';
      const input=document.createElement('input');input.type='checkbox';input.className='item-checkbox';input.checked=item.done;
      const text=document.createElement('span');text.className='item-text';text.textContent=item.text;
      input.addEventListener('change',()=>{item.done=input.checked;save();});
      label.append(input,text);
      const edit=document.createElement('button');edit.type='button';edit.className='btn btn-ghost edit-only';edit.textContent='修改';edit.setAttribute('aria-label',`修改 ${item.text}`);
      edit.addEventListener('click',()=>{
        const editor=document.createElement('input');editor.className='form-control item-editor';editor.type='text';editor.value=item.text;editor.maxLength=160;editor.setAttribute('aria-label','修改明细内容');
        const commit=document.createElement('button');commit.type='button';commit.className='btn';commit.textContent='保存';
        const cancel=document.createElement('button');cancel.type='button';cancel.className='btn btn-ghost';cancel.textContent='取消';
        row.replaceChildren(editor,commit,cancel);editor.focus();
        const commitEdit=()=>{const value=editor.value.trim();if(!value)return;const old=item.text;item.text=value;if(!canFit(snapshot())){item.text=old;saveStatus.textContent='记录容量已满';return;}render(g);save();};
        commit.addEventListener('click',commitEdit);cancel.addEventListener('click',()=>render(g));
        editor.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();commitEdit();}if(e.key==='Escape')render(g);});
      });
      const remove=document.createElement('button');remove.type='button';remove.className='btn btn-ghost edit-only';remove.textContent='删除';remove.setAttribute('aria-label',`删除 ${item.text}`);
      remove.addEventListener('click',()=>{
        if(row.querySelector('.confirm-delete'))return;
        const confirm=document.createElement('div');confirm.className='confirm-delete edit-only';confirm.setAttribute('role','group');confirm.setAttribute('aria-label','删除确认');
        const prompt=document.createElement('span');prompt.textContent=`确定删除“${item.text}”吗？`;
        const yes=document.createElement('button');yes.type='button';yes.className='btn';yes.textContent='确认删除';
        const no=document.createElement('button');no.type='button';no.className='btn btn-ghost';no.textContent='取消';
        yes.addEventListener('click',()=>{deletion={g,index,item};g.items.splice(index,1);undo.disabled=false;render(g);save();g.addInput.focus();});
        no.addEventListener('click',()=>{confirm.remove();remove.focus();});
        confirm.append(prompt,yes,no);row.append(confirm);no.focus();
      });
      row.append(label,edit,remove);g.list.append(row);
    });
  }
  function makeGroup(container,text,name) {
    const g={container,name,items:text.split(/\s*·\s*/).filter(Boolean).map(text=>({text,done:false})),list:document.createElement('div')};
    g.list.className='check-items';
    const form=document.createElement('div');form.className='add-form edit-only';
    const input=document.createElement('input');input.type='text';input.className='form-control';input.placeholder='输入新明细';input.maxLength=160;input.setAttribute('aria-label',`新增明细：${name}`);input.id=`new-detail-${sequence++}`;
    const add=document.createElement('button');add.type='button';add.className='btn';add.textContent='＋ 增加明细';
    form.append(input,add);g.addInput=input;
    const addItem=event=>{
      event.preventDefault();const text=input.value.trim();if(!text){input.focus();return;}
      g.items.push({text,done:false});
      if(!canFit(snapshot())){g.items.pop();saveStatus.textContent='本地记录容量已满，请先删除不需要的明细';return;}
      input.value='';render(g);save();input.focus();
    };
    add.addEventListener('click',addItem);
    input.addEventListener('keydown',event=>{if(event.key==='Enter' && !event.isComposing)addItem(event);});
    container.replaceChildren(g.list,form);groups.push(g);render(g);
  }
  root.querySelectorAll('.event').forEach((event,eventIndex)=>{
    const head=event.querySelector('.event-head');
    const title=head.lastElementChild;
    const label=document.createElement('label');label.className='task-label';
    const task=document.createElement('input');task.type='checkbox';task.className='item-checkbox';task.setAttribute('aria-label',`完成事项：${title.textContent}`);
    title.replaceWith(label);label.append(task,title);tasks.push(task);task.addEventListener('change',save);
    event.querySelectorAll('.group').forEach(group=>{
      const target=group.lastElementChild;
      makeGroup(target,target.textContent,group.firstElementChild.textContent);
    });
    const sub=event.querySelector(':scope > .sub');
    if(sub){const target=document.createElement('div');target.className='sub';sub.replaceWith(target);makeGroup(target,sub.textContent, title.textContent);}
    else if(!event.querySelector('.group')){const target=document.createElement('div');target.className='sub';event.append(target);makeGroup(target,'',title.textContent);}
  });
  undo.addEventListener('click',()=>{
    if(!deletion)return;
    const {g,index,item}=deletion;g.items.splice(index,0,item);
    if(!canFit(snapshot())){g.items.splice(index,1);saveStatus.textContent='本地记录容量已满，无法撤销';return;}
    deletion=null;undo.disabled=true;render(g);save();
  });
  function restore(widgetState) {
    const saved=widgetState?.privateContent?.weddingChecklist;
    if(!saved || saved.v!==1 || !Array.isArray(saved.tasks) || !Array.isArray(saved.groups) || saved.groups.length!==groups.length || !canFit(saved))return;
    if(saved.groups.some(g=>!Array.isArray(g)||g.some(i=>!Array.isArray(i)||typeof i[0]!=='string'||i[0].length>500)))return;
    const signature=JSON.stringify(saved);if(signature===appliedSignature)return;
    appliedSignature=signature;
    tasks.forEach((t,i)=>{t.checked=saved.tasks[i]===true;});
    groups.forEach((g,i)=>{g.items=saved.groups[i].map(item=>({text:item[0],done:item[1]===1}));render(g);});
    updateCount();saveStatus.textContent='已恢复当前浏览器的记录';
  }
  exportButton.addEventListener('click',()=>{
    exportButton.disabled=true;exportButton.textContent='正在生成…';
    try {
      const canvas=document.createElement('canvas');canvas.width=1200;
      const ctx=canvas.getContext('2d');if(!ctx)throw Error('canvas');
      const colors=getComputedStyle(document.documentElement);
      const dark=window.matchMedia('(prefers-color-scheme: dark)').matches;
      const palette={bg:dark?'#191919':'#ffffff',fg:dark?'#eeeeee':'#242424',muted:dark?'#a8a8a8':'#686868',line:dark?'#383838':'#dddddd',dot:dark?'#8abbee':'#326ca4'};
      const ops=[];let y=42;
      function text(value,x,width,size=25,color=palette.fg,weight=400){
        const font=`${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`;
        ctx.font=font;let line='';const rows=[];
        for(const ch of value){if(ch==='\n'||(line&&ctx.measureText(line+ch).width>width)){rows.push(line);line=ch==='\n'?'':ch;}else line+=ch;}
        if(line)rows.push(line);
        for(const row of rows){ops.push({type:'text',text:row,x,y,font,color});y+=size*1.55;}
      }
      text('婚礼筹备时间线 · 3—7 号',36,1128,34,palette.fg,500);
      text('全部清单 · ✓ 表示已完成',36,1128,22,palette.muted);y+=26;
      root.querySelectorAll('.day').forEach(day=>{
        const start=y;let first=true;
        day.querySelectorAll('.event').forEach(event=>{
          const top=y;
          if(first){const savedY=y;text(day.querySelector('.date').textContent,36,94,25,palette.fg,500);y=savedY;first=false;}
          ops.push({type:'dot',x:140,y:top+15});
          const head=event.querySelector('.event-head');const done=head.querySelector('input').checked;
          text((done?'✓ ':'')+head.querySelector('.time').textContent+'  '+head.querySelector('.task-label span').textContent,170,994,26,palette.fg,500);
          y+=8;let lastDetail=null;
          groups.filter(g=>event.contains(g.container)).forEach(g=>{
            if(!g.items.length)return;
            const detail=g.container.closest('details');
            if(detail&&detail!==lastDetail){text(detail.querySelector('summary').textContent,170,994,25,palette.fg,500);y+=6;lastDetail=detail;}
            const value=g.items.map(i=>(i.done?'✓ ':'')+i.text).join(' · ');
            if(g.container.closest('.group')){const top=y;text(g.name,170,138,24,palette.muted);const labelEnd=y;y=top;text(value,320,844,25);y=Math.max(y,labelEnd);}
            else text(value,170,994,25);
            y+=10;
          });
          y+=26;
        });
        ops.unshift({type:'line',x:140,start:start+15,end:y-25});y+=26;
      });
      if(y>16000)throw Error('too-long');
      canvas.height=Math.ceil(y+20);ctx.fillStyle=palette.bg;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.textBaseline='top';
      for(const op of ops){
        if(op.type==='text'){ctx.font=op.font;ctx.fillStyle=op.color;ctx.fillText(op.text,op.x,op.y);}
        else if(op.type==='line'){ctx.strokeStyle=palette.line;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(op.x,op.start);ctx.lineTo(op.x,op.end);ctx.stroke();}
        else {ctx.fillStyle=palette.dot;ctx.beginPath();ctx.arc(op.x,op.y,6,0,Math.PI*2);ctx.fill();}
      }
      parent.postMessage({type:'wedding-png-preview',png:canvas.toDataURL('image/png')},'*');
    }catch(error){saveStatus.textContent=error.message==='too-long'?'清单过长，请减少明细后导出':'图片生成失败，请重试';}
    finally{exportButton.disabled=false;exportButton.textContent='导出长图';}
  });
  restore(window.openai?.widgetState);
  window.addEventListener('openai:set_globals',event=>restore(event.detail?.globals?.widgetState));
  updateCount();
})();
