/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ControllerInputSystem } from './input.js';
import { PanelSystem } from './panel.js';
import { RobotSystem } from './robot.js';
import { EveConsoleSystem } from './eve-console-system.js';
import { EveBrowserSystem } from './eve-browser-system.js';
import { mountWorkbench } from './eve-workbench.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(RobotSystem);
  world.registerSystem(PanelSystem);
  world.registerSystem(ControllerInputSystem);
  world.registerSystem(EveConsoleSystem);
  world.registerSystem(EveBrowserSystem);
  mountWorkbench(world);
}).catch((error) => {
  console.error('The XR workspace could not start:', error);
  const message = document.createElement('p');
  message.style.cssText = 'position:fixed;inset:20%;color:white;font:16px/1.6 system-ui';
  message.textContent = 'The 3D workspace could not start. Check that WebGL is enabled, then reload this page.';
  document.body.append(message);
});
