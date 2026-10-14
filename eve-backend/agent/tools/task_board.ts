import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { taskBoard } from '../lib/task-board';

export default defineTool({
  description: 'List, add, or update tasks in this conversation’s durable task board. Adding requires title; updating requires taskId and status. Never mark work done without evidence or user confirmation.',
  inputSchema: z.object({
    operation: z.enum(['list', 'add', 'update']),
    title: z.string().trim().min(1).max(160).optional(),
    taskId: z.string().max(100).optional(),
    status: z.enum(['todo', 'in_progress', 'done']).optional(),
  }),
  execute({ operation, title, taskId, status }) {
    if (operation === 'add') {
      if (!title) throw new Error('A title is required to add a task.');
      if (taskBoard.get().length >= 100) throw new Error('This conversation already has 100 tasks.');
      const existing = taskBoard.get().find(task => task.title.toLowerCase() === title.toLowerCase());
      if (!existing) taskBoard.update(tasks => [...tasks, { id: crypto.randomUUID(), title, status: 'todo' }]);
    } else if (operation === 'update') {
      if (!taskId || !status) throw new Error('taskId and status are required to update a task.');
      if (!taskBoard.get().some(task => task.id === taskId)) throw new Error('That task does not exist.');
      taskBoard.update(tasks => tasks.map(task => task.id === taskId ? { ...task, status } : task));
    }
    return { tasks: taskBoard.get() };
  },
});
