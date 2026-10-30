"use client";
import { useEffect, useRef, useState } from 'react';
import { reorderTool, TOOL_ORDER_KEY, readToolOrder, mergeToolOrder } from './tool-order';

export type ToolTab = { id:string;label:string;active:boolean;live?:boolean;visible?:boolean;select:()=>void };
export function ToolNavigation({items,language}:{items:ToolTab[];language:'zh'|'en'}) {
  const [saved,setSaved]=useState(readToolOrder);
  const [dragging,setDragging]=useState<string|null>(null);
  const list=useRef<HTMLElement>(null);
  const gesture=useRef<{id:string;x:number;y:number;pointer:number;moved:boolean;order:string[];centers:number[];scroll:number;fullOrder:string[]}|null>(null);
  const suppressClick=useRef(false);
  const fullOrder=mergeToolOrder(saved,items.map(t=>t.id));
  const ordered=fullOrder.filter(id=>items.find(t=>t.id===id)?.visible!==false);
  const zh=language==='zh';
  const move=(id:string,target:string)=>setSaved(current=>reorderTool(mergeToolOrder(current,items.map(t=>t.id)),id,target));
  useEffect(()=>{try {localStorage.setItem(TOOL_ORDER_KEY,JSON.stringify(saved));} catch {/* Session ordering still works. */}},[saved]);
  useEffect(()=>{
    const sync=(event:StorageEvent)=>{if(event.key===TOOL_ORDER_KEY)setSaved(readToolOrder());};
    const sameDocument=()=>setSaved(readToolOrder());
    window.addEventListener('storage',sync);window.addEventListener('piclite:tool-order',sameDocument);
    return()=>{window.removeEventListener('storage',sync);window.removeEventListener('piclite:tool-order',sameDocument);};
  },[]);
  const finish=()=>{if(gesture.current?.moved)suppressClick.current=true;gesture.current=null;setDragging(null);};
  return <div className="tool-navigation">
    <button type="button" className="nav-scroll" aria-label={zh?'向左滚动工具':'Scroll tools left'} onClick={()=>list.current?.scrollBy({left:-200,behavior:'smooth'})}>‹</button>
    <nav ref={list} className="main-nav tool-tabs" aria-label={zh?'主要功能，可拖动排序':'Tools, drag to reorder'} onDragStart={event=>event.preventDefault()} onPointerMove={event=>{
      const g=gesture.current;if(!g||event.pointerId!==g.pointer)return;
      if(!g.moved&&Math.hypot(event.clientX-g.x,event.clientY-g.y)<6)return;
      if(!g.moved)event.currentTarget.setPointerCapture(event.pointerId);
      g.moved=true;setDragging(g.id);event.preventDefault();
      const root=list.current;if(!root)return;
      const rect=root.getBoundingClientRect();
      if(event.clientX>rect.right-36)root.scrollLeft+=16;
      else if(event.clientX<rect.left+36)root.scrollLeft-=16;
      const x=event.clientX+root.scrollLeft-g.scroll;
      const from=g.order.indexOf(g.id);
      let target=from;
      if(x>g.x){for(let i=from+1;i<g.centers.length;i++)if(x>=g.centers[i]-1)target=i;}
      else {for(let i=from-1;i>=0;i--)if(x<=g.centers[i]+1)target=i;}
      setSaved(reorderTool(g.fullOrder,g.id,g.order[target]));
    }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      {ordered.map(id=>{const tab=items.find(t=>t.id===id)!;return <button type="button" key={id} data-tool-id={id} draggable={false} aria-current={tab.active?'page':undefined} className={`${tab.active?'active':''} ${dragging===id?'reordering':''}`} title={zh?'拖动调整顺序；Alt + 左右键移动':'Drag to reorder; Alt + arrows to move'} onPointerDown={event=>{
        if(event.button!==0)return;suppressClick.current=false;
        const centers=[...list.current!.querySelectorAll<HTMLElement>('[data-tool-id]')].map(tab=>{const r=tab.getBoundingClientRect();return (r.left+r.right)/2;});
        gesture.current={id,x:event.clientX,y:event.clientY,pointer:event.pointerId,moved:false,order:ordered,centers,scroll:list.current!.scrollLeft,fullOrder};
      }} onKeyDown={event=>{
        if(!event.altKey||!['ArrowLeft','ArrowRight'].includes(event.key))return;
        event.preventDefault();const i=ordered.indexOf(id),target=ordered[i+(event.key==='ArrowLeft'?-1:1)];if(target)move(id,target);
      }} onClick={()=>{if(suppressClick.current){suppressClick.current=false;return;}tab.select();}}>
        <span>{tab.label}</span>{tab.live&&<i className="live-dot" aria-label={zh?'监测中':'Watching'}/>}
      </button>;})}
    </nav>
    <button type="button" className="nav-scroll" aria-label={zh?'向右滚动工具':'Scroll tools right'} onClick={()=>list.current?.scrollBy({left:200,behavior:'smooth'})}>›</button>
    <span className="visually-hidden" role="status">{dragging?(zh?'正在调整工具顺序':'Reordering tools'):''}</span>
  </div>;
}
