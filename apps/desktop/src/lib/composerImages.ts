import type { TFn } from './i18n'
export type AttachedImage={name:string;mime:string;data:string}
export async function imageFromFile(file:File,t:TFn):Promise<AttachedImage>{
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw new Error(t('error.imagesOnly'))
  if(file.size>8*1024*1024)throw new Error(t('error.imageTooLarge'))
  const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)})
  return {name:file.name||t('error.pastedImage'),mime:file.type,data}
}
