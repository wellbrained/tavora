import { expect, it } from 'vitest';
import { allocationCounts } from './tree-counts';
it('counts unique total nodes and only explicit weapon-set allocations',()=>{
 expect(allocationCounts([{id:'shared',weapon:0},{id:'a',weapon:1},{id:'b',weapon:2},{id:'a',weapon:1},{id:'both',weapon:1},{id:'both',weapon:2}])).toEqual({total:4,set1:2,set2:2});
 expect(allocationCounts([])).toEqual({total:0,set1:0,set2:0});
});
