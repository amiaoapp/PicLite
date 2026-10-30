import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Crop, DotsThree } from "@phosphor-icons/react";
import { Icon } from "./clop-icons";
import { FloatingPreviewImage } from "./floating-preview-image";
import type { ImageFormat, Language, OptimisationPreset, PicLiteBridge } from "./clop-types";
import { tr } from "./clop-store";
import { editorCompressionSettings } from "./floating-editor-model";
import "./floating-result-editor.css";

type Actions={quality:()=>void;save:()=>void};
type Props={
  api:PicLiteBridge;path?:string;preview?:string;width?:number;height?:number;
  filename:string;language:Language;format?:string;quality:number;
  renderPreview:(actions:Actions)=>ReactNode;renderMenu:(actions:Actions)=>ReactNode;disabled?:boolean;
  process?:(settings:Partial<OptimisationPreset>,source?:string)=>Promise<void>;
  updateFormat:(format:ImageFormat)=>void;dismiss:()=>void;
  notify:(message:string,tone?:"error"|"success")=>void;
};

export function FloatingResultEditor(p:Props){
  const [qualityMode,setQualityMode]=useState(false),[menu,setMenu]=useState(false),[busy,setBusy]=useState(false);
  const [quality,setQuality]=useState(p.quality);
  const [format,setFormat]=useState<ImageFormat>(["jpeg","png","webp"].includes(p.format||"")?p.format as ImageFormat:"keep");
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null),running=useRef(false);
  const t=(zh:string,en:string)=>tr(p.language,zh,en);
  const canEdit=!!p.path&&!!p.process&&!p.disabled;
  useEffect(()=>{
    if(!qualityMode&&!menu)return;
    panel.current?.querySelector<HTMLElement>('button:not(:disabled),input')?.focus();
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setMenu(false);};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[qualityMode,menu]);
  const close=()=>{if(running.current)return;setQualityMode(false);setMenu(false);trigger.current?.focus();};
  const run=async(action:()=>Promise<unknown>)=>{
    if(running.current)return;running.current=true;setBusy(true);
    try{await action();}catch(error){p.notify(error instanceof Error?error.message:String(error),'error');}
    finally{running.current=false;setBusy(false);}
  };
  const save=()=>run(async()=>{
    if(!p.path)return;const folder=await p.api.selectFolder('export');if(!folder)return;
    const output=await p.api.saveFloatingResult(p.path,folder);p.notify(t('已保存副本：','Copy saved: ')+output);setMenu(false);
  });
  const crop=()=>run(async()=>{
    if(!p.path||!p.process)return;setMenu(false);
    const output=await p.api.openCropEditor(p.path);
    if(output)await p.process(editorCompressionSettings(quality,format),output);
  });
  const apply=()=>run(async()=>{await p.process?.(editorCompressionSettings(quality,format));setQualityMode(false);});
  const actions={quality:()=>{setMenu(false);setQualityMode(true);},save:()=>void save()};
  const Preview=p.renderPreview,Menu=p.renderMenu;
  return <div ref={root} className={`floating-card-content ${qualityMode?'is-editing':''}`} data-interacting={qualityMode||menu||busy}
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}
    onContextMenu={event=>{event.preventDefault();event.stopPropagation();if(!busy)setMenu(true);}}>
    {!qualityMode && p.preview && <FloatingPreviewImage src={p.preview} alt={p.filename} width={p.width} height={p.height}/>}
    <header className="floating-card-header" onPointerDown={event=>event.stopPropagation()}>
      <button data-action="dismiss" className="floating-card-icon" aria-label={t('移除','Dismiss')} title={t('移除','Dismiss')} disabled={busy} onClick={event=>{event.stopPropagation();p.dismiss();}}><Icon name="close"/></button>
      <span>{qualityMode?t('压缩质量','Compression quality'):''}</span>
      <button ref={trigger} data-action="more" className="floating-card-icon" aria-label={t('更多操作','More actions')} title={t('更多操作','More actions')} aria-haspopup="menu" aria-expanded={menu} disabled={busy} onClick={event=>{event.stopPropagation();setMenu(!menu);}}><DotsThree weight="bold"/></button>
    </header>
    <div className="floating-card-body">
      {!qualityMode?<Preview {...actions}/>:<section ref={panel} className="floating-editor-panel mode-quality" aria-label={t('压缩质量','Compression quality')} onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()} onWheel={event=>event.stopPropagation()}>
        <div className="floating-editor-parameters"><div className="floating-quality-preview">{p.preview&&<img src={p.preview} alt=""/>}<p>{t('调整编码质量，体积以处理结果为准。','Encoder quality; size is measured after processing.')}</p></div>
          <label className="floating-editor-quality"><span>{t('编码质量','Encoder quality')}<output>{quality}%</output></span><input aria-label={t('编码质量','Encoder quality')} type="range" min="1" max="100" value={quality} disabled={busy} onChange={event=>setQuality(Number(event.target.value))}/></label>
        </div>
        <footer className="floating-editor-footer"><button disabled={busy} onClick={close}>{t('取消','Cancel')}</button><button data-action="apply-edit" className="primary" disabled={busy} onClick={()=>void apply()}>{busy?t('处理中…','Processing…'):t('应用','Apply')}</button></footer>
      </section>}
    </div>
    <div className="floating-card-bottom" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
      <button data-action="crop" className="floating-card-icon crop-window-trigger" disabled={busy||!canEdit} aria-label={t('打开裁切编辑器','Open crop editor')} title={t('裁切与尺寸（独立窗口）','Crop and resize in a separate window')} onClick={()=>void crop()}><Crop/></button>
      <div className="format-bar floating-card-formats" aria-label={t('输出格式','Output format')}>
        {(['keep','jpeg','webp','png'] as ImageFormat[]).map(f=><button key={f} data-format={f} disabled={busy||!p.path||p.disabled} className={(qualityMode?format===f:p.format===f)?'active':''} aria-pressed={qualityMode?format===f:p.format===f} onClick={()=>{setFormat(f);if(!qualityMode)p.updateFormat(f);}}>{f==='keep'?'Auto':f.toUpperCase()}</button>)}
      </div>
    </div>
    {menu&&<section ref={panel} className="floating-overflow-menu" role="menu" aria-label={t('结果操作','Result actions')} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();if((event.target as HTMLElement).closest('button:not([data-action=save])'))setMenu(false);}} onWheel={event=>event.stopPropagation()} onKeyDown={event=>{
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();
      const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
    }}>
      <button data-action="save" role="menuitem" disabled={busy||!p.path||p.disabled} onClick={()=>void save()}><Icon name="save"/>{t('保存副本…','Save copy…')}</button><Menu {...actions}/>
    </section>}
  </div>;
}
