"use client";
/* eslint-disable @next/next/no-img-element -- locally owned image Blob URLs */
import {useRef,useState} from "react";
import "./browser-image-tool.css";
export type BrowserToolOptions={kind:"convert"|"resize";format:"keep"|"image/jpeg"|"image/png"|"image/webp";quality:number;scale:number;resize:boolean;width:number;height:number;lockRatio:boolean};
export type BrowserToolItem={id:string;name:string;width:number;height:number;originalBytes:number;sourceUrl:string;outputUrl?:string;outputBytes?:number;outputWidth?:number;outputHeight?:number;status:string;error?:string};
type Props={kind:"convert"|"resize";language:"zh"|"en";items:BrowserToolItem[];busy:boolean;quality:number;onImport:(files:File[])=>Promise<void>;onProcess:(options:BrowserToolOptions)=>Promise<void>;onDownload:(id:string)=>void;onRemove:(id:string)=>void};
export function BrowserImageTool({kind,language,items,busy,quality:initialQuality,onImport,onProcess,onDownload,onRemove}:Props){
 const input=useRef<HTMLInputElement>(null);
 const [format,setFormat]=useState<BrowserToolOptions["format"]>("image/webp"),[quality,setQuality]=useState(initialQuality);
 const [mode,setMode]=useState("scale"),[scale,setScale]=useState(50),[width,setWidth]=useState(1920),[height,setHeight]=useState(1080),[lockRatio,setLockRatio]=useState(true),[selected,setSelected]=useState<string>();
 const t=(zh:string,en:string)=>language==="en"?en:zh;
 const current=items.find(item=>item.id===selected)||items[0];
 const result=current?.outputUrl||current?.sourceUrl;
 const bytes=(n?:number)=>n===undefined?"—":n<1024?`${n} B`:`${(n/1024).toFixed(1)} KB`;
 const run=()=>onProcess({kind,format:kind==="convert"?format:"keep",quality,scale:kind==="resize"&&mode==="scale"?scale:100,resize:kind==="resize"&&mode!=="scale",width,height,lockRatio});
 return <section className="browser-image-tool" data-tool={kind} aria-label={t(kind==="convert"?"格式转换工具":"尺寸调整工具",kind==="convert"?"Format converter":"Image resize tool")}>
  <header className="web-tool-hero"><div><span className="eyebrow">{kind==="convert"?"FORMAT CONVERTER":"IMAGE RESIZE"}</span><h1>{t(kind==="convert"?"格式转换":"尺寸调整",kind==="convert"?"Convert image format":"Resize images")}</h1><p>{t(kind==="convert"?"选择输出格式，单独转换图片，原文件保持不变。":"按比例或指定尺寸生成新图片，原文件保持不变。",kind==="convert"?"Choose an output format. Source files stay unchanged.":"Scale images or choose target dimensions. Source files stay unchanged.")}</p></div><button type="button" disabled={busy} onClick={()=>input.current?.click()}>{t("添加图片","Add images")}</button></header>
  <input ref={input} className="visually-hidden" type="file" multiple accept="image/*" onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value="";void onImport(files);}}/>
  <div className="web-tool-layout">
   <aside className="web-tool-queue"><h2>{t("图片队列","Images")} · {items.length}</h2>{items.length?items.map(item=><article key={item.id} className={`web-tool-item ${item.status} ${item.id===current?.id?"selected":""}`}><button className="web-tool-select" type="button" onClick={()=>setSelected(item.id)}><img src={item.sourceUrl} alt=""/><span><strong>{item.name}</strong><small>{item.width} × {item.height} · {bytes(item.originalBytes)}</small><small>{item.error|| (item.status==="processing"?t("处理中…","Processing…"):item.status==="done"?`${item.outputWidth} × ${item.outputHeight} · ${bytes(item.outputBytes)}`:t("等待处理","Ready"))}</small></span></button><button type="button" disabled={busy} aria-label={t("移除图片","Remove image")} onClick={()=>onRemove(item.id)}>×</button></article>):<button type="button" className="web-tool-empty" onClick={()=>input.current?.click()}><span>＋</span>{t("添加要处理的图片","Add images to begin")}</button>}</aside>
   <section className="web-tool-controls"><h2>{t("处理参数","Output settings")}</h2>
    {kind==="convert"?<label>{t("输出格式","Output format")}<select id="web-tool-format" disabled={busy} value={format} onChange={event=>setFormat(event.target.value as BrowserToolOptions["format"])}><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option><option value="image/png">PNG</option></select></label>:<>
     <label>{t("调整方式","Resize mode")}<select disabled={busy} id="web-resize-mode" value={mode} onChange={event=>setMode(event.target.value)}><option value="scale">{t("按比例缩放","Scale percentage")}</option><option value="dimensions">{t("指定尺寸","Target dimensions")}</option></select></label>
     {mode==="scale"?<label>{t("缩放比例（%）","Scale (%)")}<input id="web-resize-scale" type="number" min="1" max="100" disabled={busy} value={scale} onChange={event=>setScale(Math.max(1,Math.min(100,Number(event.target.value)||1)))}/></label>:<><div className="web-tool-dimensions"><label>{t("宽度（px）","Width (px)")}<input id="web-resize-width" type="number" min="1" max="16384" disabled={busy} value={width} onChange={event=>setWidth(Math.max(1,Math.min(16384,Number(event.target.value)||1)))}/></label><label>{t("高度（px）","Height (px)")}<input id="web-resize-height" type="number" min="1" max="16384" disabled={busy} value={height} onChange={event=>setHeight(Math.max(1,Math.min(16384,Number(event.target.value)||1)))}/></label></div><label className="web-tool-check"><input type="checkbox" disabled={busy} checked={lockRatio} onChange={event=>setLockRatio(event.target.checked)}/>{t("保持比例，适应边界","Keep ratio, fit within bounds")}</label></>}
    </>}
    <label>{t("编码质量","Encoder quality")} · {quality}%<input id="web-tool-quality" type="range" min="1" max="100" disabled={busy} value={quality} onChange={event=>setQuality(Number(event.target.value))}/></label>
    <button type="button" className="primary web-tool-run" disabled={busy||!items.length} onClick={()=>void run()}>{busy?t("处理中…","Processing…"):t(kind==="convert"?"开始转换":"应用尺寸",kind==="convert"?"Convert images":"Apply dimensions")}</button>
    <p className="web-tool-note">{t("在当前浏览器本地处理。结果可保存到下载文件夹，也会加入图库。","Processed locally in this browser. Save results as downloads or find them in Library.")}</p>
   </section>
   <section className="web-tool-preview"><h2>{t("结果预览","Result preview")}</h2>{result?<><div className="web-tool-result"><img src={result} alt={t("工具处理预览","Tool result preview")}/></div><div className="web-tool-result-info"><span>{current?.outputWidth||current?.width} × {current?.outputHeight||current?.height} · {bytes(current?.outputBytes??current?.originalBytes)}</span><button type="button" disabled={busy||current?.status!=="done"} onClick={()=>{if(current)onDownload(current.id)}}>{t("保存结果","Save result")}</button></div></>:<div className="web-tool-placeholder">{t("添加图片后在这里预览","Add an image to preview it here")}</div>}</section>
  </div>
 </section>;
}
