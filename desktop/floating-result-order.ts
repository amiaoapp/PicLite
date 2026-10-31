export function promoteFloatingResult<T extends {id:string}>(items:T[], id:string):T[] {
  const index=items.findIndex(item=>item.id===id);
  return index<=0?items:[items[index],...items.slice(0,index),...items.slice(index+1)];
}
