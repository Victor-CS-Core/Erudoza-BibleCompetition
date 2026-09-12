import { Button, Notice } from '../../components/ui';
export function PbeBankCoverage({coveredSources,assignedSources,singleVariantTargets,uncoveredTargets=0,onAdd}:{coveredSources:number;assignedSources:number;singleVariantTargets:number;uncoveredTargets?:number;onAdd?:()=>void}) {
 return <section aria-label="PBE bank coverage"><h3>Published bank coverage</h3><p>{coveredSources} of {assignedSources} assigned passages have questions</p><p>{singleVariantTargets} targets need another question variant</p><p>{uncoveredTargets} declared targets have no published questions</p><Notice>These counts describe published questions, not complete knowledge of a passage or chapter. Drafts do not count.</Notice>{onAdd&&<Button variant="secondary" onClick={onAdd}>Add a PBE question</Button>}</section>;
}
