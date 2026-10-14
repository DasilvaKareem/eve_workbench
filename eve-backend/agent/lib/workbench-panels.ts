import { defineState } from 'eve/context';
import type { WorkbenchPanel } from '../../shared/workbench-panels';

export const workbenchPanels = defineState<WorkbenchPanel[]>('eve-workbench.panels.v1', () => []);
