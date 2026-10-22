/** Readable type sizes shared by module hover cards and the host-owned rich tooltip. */
export const TOOLTIP_TYPE={title:18,text:14,meta:14,small:12} as const;
export const TOOLTIP_TOKENS=Object.entries(TOOLTIP_TYPE).map(([key,value])=>'--tavora-tooltip-'+key+'-size:'+value+'px').join(';');
