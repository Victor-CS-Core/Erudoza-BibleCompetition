import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PbePresentation } from './PbePresentation';
import type { SpeechPort } from './pbeSpeech';

it('starts speech only from the ready gesture and acknowledges two completed readings', async () => {
  const ends: (() => void)[] = [];
  const port: SpeechPort = { speak: vi.fn((_text, end) => ends.push(end)), cancel: vi.fn() };
  const ready = vi.fn();
  render(<PbePresentation text="For one point. John 1:1. Name the Word." createPort={async () => port} onReady={ready}/>);
  expect(port.speak).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /ready to hear/i }));
  await act(async () => {});
  expect(port.speak).toHaveBeenCalledTimes(1);
  await act(async () => ends[0]());
  await act(async () => ends[1]());
  expect(ready).toHaveBeenCalledWith('Audio');
});

it('requires two explicit confirmations for text fallback', async () => {
  const ready = vi.fn();
  render(<PbePresentation text="Question text" createPort={async () => null} onReady={ready}/>);
  fireEvent.click(screen.getByRole('button', { name: /ready to hear/i }));
  expect(await screen.findByText(/text reading 1 of 2/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /finished first reading/i }));
  expect(screen.getByText(/text reading 2 of 2/i)).toBeInTheDocument();
  expect(ready).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /finished second reading/i }));
  expect(ready).toHaveBeenCalledWith('TextFallback');
});

it('cancels speech on unmount without acknowledging readiness', async () => {
  const port: SpeechPort = { speak: vi.fn(), cancel: vi.fn() };
  const ready = vi.fn();
  const view = render(<PbePresentation text="Question" createPort={async () => port} onReady={ready}/>);
  fireEvent.click(screen.getByRole('button', { name: /ready to hear/i }));
  await act(async () => {});
  view.unmount();
  expect(port.cancel).toHaveBeenCalled();
  expect(ready).not.toHaveBeenCalled();
});

it('uses explicit text fallback while the tab is hidden', async () => {
  const visible = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  const port: SpeechPort = { speak: vi.fn(), cancel: vi.fn() };
  render(<PbePresentation text="Question" createPort={async () => port} onReady={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: /ready to hear/i }));
  expect(screen.getByText(/text reading 1 of 2/i)).toBeInTheDocument();
  expect(port.speak).not.toHaveBeenCalled();
  if (visible) Object.defineProperty(document, 'visibilityState', visible); else Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
});

it('recovers from missing or failed speech setup and lets a stalled reading switch to text', async () => {
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
  const failed=render(<PbePresentation text="Question" createPort={async()=>{throw new Error('missing')}} onReady={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:/ready to hear/i}));
  expect(await screen.findByText(/text reading 1 of 2/i)).toBeInTheDocument();failed.unmount();
  const port:SpeechPort={speak:vi.fn(),cancel:vi.fn()};
  render(<PbePresentation text="Question" createPort={async()=>port} onReady={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:/ready to hear/i}));await act(async()=>{});
  fireEvent.click(screen.getByRole('button',{name:/use text fallback/i}));
  expect(port.cancel).toHaveBeenCalled();expect(screen.getByText(/text reading 1 of 2/i)).toBeInTheDocument();
});

it('cancels active speech when the tab becomes hidden without acknowledging audio',async()=>{
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
  const port:SpeechPort={speak:vi.fn(),cancel:vi.fn()},ready=vi.fn();
  render(<PbePresentation text="Question" createPort={async()=>port} onReady={ready}/>);
  fireEvent.click(screen.getByRole('button',{name:/ready to hear/i}));await act(async()=>{});
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});await act(async()=>fireEvent(document,new Event('visibilitychange')));
  expect(port.cancel).toHaveBeenCalled();expect(ready).not.toHaveBeenCalled();expect(screen.getByText(/text reading 1 of 2/i)).toBeInTheDocument();
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
});
