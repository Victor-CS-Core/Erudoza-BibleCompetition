import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { pbeApi } from '../../api/practice';
import { PbeQuestionEditor } from './PbeQuestionEditor';
import { ToastProvider } from "../../components/ui";
vi.mock('../../api/practice',()=>({pbeApi:{authoring:vi.fn().mockResolvedValue({sources:[{id:'source',contentPackId:'pack',citation:'GEN 1:1',canonicalText:'Alpha',sourceKind:'Scripture'}],selectedBookKeys:['GEN'],members:[],membersNextCursor:null,pbeEnabled:false}),bank:vi.fn().mockResolvedValue({questionCount:0,targetCount:0,sourceUnitCount:1,missingSourceUnitIds:['source'],singleVariantTargets:0,uncoveredTargets:0}),targets:vi.fn().mockResolvedValue({items:[],nextCursor:null}),questions:vi.fn().mockResolvedValue({items:[],nextCursor:null}),introductions:vi.fn().mockResolvedValue([])}}));
it('requires a target before preview and shows the actual selected source',async()=>{
 render(<QueryClientProvider client={new QueryClient()}><ToastProvider><PbeQuestionEditor org="org" season="season"/></ToastProvider></QueryClientProvider>);
 await screen.findByText('0 of 1 assigned passages have questions');fireEvent.change(screen.getByLabelText('PBE source'),{target:{value:'source'}});expect(screen.getByText('Alpha')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Preview PBE question'}));expect(await screen.findByText('Choose a learning target for every scoring part.')).toBeVisible();
});
it('requires deliberate source and target mapping for a legacy conversion without reusing its identity',async()=>{
 const legacy={id:'legacy-id',version:7,contentPackId:'pack',sourceUnitId:'source',prompt:'Legacy wording',kind:'ShortAnswer',parts:[{acceptedAnswers:['Legacy answer'],points:1}],ordered:false,evidence:'Alpha',reference:'GEN 1:1'};
 render(<QueryClientProvider client={new QueryClient()}><ToastProvider><PbeQuestionEditor org="org" season="season" initialLegacy={legacy}/></ToastProvider></QueryClientProvider>);
 await screen.findByText('0 of 1 assigned passages have questions');expect(screen.getByLabelText('PBE prompt')).toHaveValue('Legacy wording');expect(screen.getByLabelText('Part 1 accepted wordings')).toHaveValue('Legacy answer');expect(screen.getByLabelText('PBE source')).toHaveValue('');expect(screen.getByLabelText('Learning target')).toHaveValue('');expect(screen.getByText('Version 1 · New question identity')).toBeVisible();fireEvent.change(screen.getByLabelText('PBE source'),{target:{value:'source'}});expect(screen.getByLabelText('Part 1 accepted wordings')).toHaveValue('Legacy answer');
});

it('previews multiple sources in the selected citation order',async()=>{
 vi.mocked(pbeApi.authoring).mockResolvedValueOnce({sources:[{id:'one',contentPackId:'pack',citation:'GEN 1:1',canonicalText:'First',sourceKind:'Scripture',bookKey:'GEN',chapter:1,verse:1},{id:'two',contentPackId:'pack',citation:'GEN 1:2',canonicalText:'Second',sourceKind:'Scripture',bookKey:'GEN',chapter:1,verse:2}],selectedBookKeys:['GEN'],members:[],membersNextCursor:null,pbeEnabled:false});
 render(<QueryClientProvider client={new QueryClient()}><ToastProvider><PbeQuestionEditor org="org" season="season"/></ToastProvider></QueryClientProvider>);await screen.findByRole('option',{name:'GEN 1:2'});fireEvent.change(screen.getByLabelText('PBE source'),{target:{value:'two'}});fireEvent.click(screen.getByText('Additional source passages'));fireEvent.click(screen.getByRole('checkbox',{name:'GEN 1:1'}));expect(screen.getByRole('blockquote')).toHaveTextContent('Second First');
});
