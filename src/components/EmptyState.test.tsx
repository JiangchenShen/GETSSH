// @vitest-environment jsdom

import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmptyState } from './EmptyState';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('EmptyState', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the empty state component correctly', () => {
    render(<EmptyState />);

    // Check if the translated text is rendered
    const textElement = screen.getByText('sidebar.emptyState');
    expect(textElement).toBeDefined();
    expect(textElement.tagName.toLowerCase()).toBe('p');

    // Check if the opacity container is rendered
    const container = textElement.parentElement;
    expect(container?.className).toContain('opacity-30');
    expect(container?.className).toContain('flex-col');
  });
});
