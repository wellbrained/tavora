import type {Item,QuestChoice} from './model';
export function itemMetadata(value:Record<string,unknown>):Partial<Item>;
export function questChoices(value:unknown):QuestChoice[];
export function questAdvice(value:unknown):{text:string;quest:string}[];
