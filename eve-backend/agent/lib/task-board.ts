import { defineState } from 'eve/context';

export interface Task {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done';
}

export const taskBoard = defineState<Task[]>('eve-workbench.tasks.v1', () => []);
