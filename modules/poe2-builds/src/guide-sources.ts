import type { TavoraSDK } from '@tavora/sdk';
import { importMobalytics, mobalyticsAddress, type GuideImport } from './mobalytics-import';
import { importPoeVault, poeVaultAddress } from './poevault-import';
import { t } from './i18n';

/** The guide sites the URL importer reads. Checked before any request is made. */
export function guideAddress(input:string):{canonical:string;load:(network:TavoraSDK['network'])=>Promise<GuideImport>} {
 let host='';try{host=new URL(input.trim()).hostname;}catch{throw Error(t('error.guideUrl'));}
 if(host==='mobalytics.gg'){const a=mobalyticsAddress(input);return {canonical:a.canonical,load:network=>importMobalytics(a.url,network)};}
 if(host==='www.poe-vault.com'||host==='poe-vault.com'){const a=poeVaultAddress(input);return {canonical:a.canonical,load:network=>importPoeVault(a.url,network)};}
 throw Error(t('error.guideSite'));
}
