import {
  act,
  render as renderComponent,
  type RenderOptions,
} from '@testing-library/react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import { createExplorerRouter } from '../router';

const Content = createContext<ReactNode>(null);
function TestPage() {
  return useContext(Content);
}
/** Real route matching and validation, with isolated router instances per mount. */
export function TestRouter({
  children,
  history,
}: {
  children: ReactNode;
  history?: RouterHistory;
}) {
  const [router] = useState(() => createExplorerRouter(history, TestPage));
  return (
    <Content.Provider value={children}>
      <RouterProvider router={router} />
    </Content.Provider>
  );
}
export function TestApp() {
  const [router] = useState(createExplorerRouter);
  return <RouterProvider router={router} />;
}

export async function render(ui: ReactNode, options?: RenderOptions) {
  let result!: ReturnType<typeof renderComponent>;
  await act(async () => {
    result = renderComponent(ui, options);
  });
  return result;
}
