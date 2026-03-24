/**
 * @format
 */

import 'react-native';
import React from 'react';
import App from '../App';
import {it} from '@jest/globals';
import renderer, {act} from 'react-test-renderer';

it('renders without crashing', async () => {
  let tree: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<App />);
  });
  await act(async () => {
    await new Promise<void>(r => setTimeout(r, 50));
  });
  expect(tree!.toJSON()).toBeTruthy();
});
