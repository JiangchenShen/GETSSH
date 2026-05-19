// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TabBar } from '../TabBar';

describe('TabBar Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    tabs: [
      { id: 'tab1', title: 'Server 1', config: {} },
      { id: 'tab2', title: 'Server 2', config: {} },
    ],
    activeTabId: 'tab1',
    isDark: true,
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
  };

  it('renders correctly with SSH tabs', () => {
    render(<TabBar {...defaultProps} />);
    expect(screen.getByText('Server 1')).toBeDefined();
    expect(screen.getByText('Server 2')).toBeDefined();
  });

  it('filters out the settings tab', () => {
    const props = {
      ...defaultProps,
      tabs: [
        ...defaultProps.tabs,
        { id: 'settings', title: 'Settings', config: {} },
      ],
    };
    render(<TabBar {...props} />);
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('renders nothing if there are no SSH tabs', () => {
    const props = {
      ...defaultProps,
      tabs: [{ id: 'settings', title: 'Settings', config: {} }],
    };
    const { container } = render(<TabBar {...props} />);
    expect(container.firstChild).toBeNull();
  });

  it('applies dark mode styling correctly', () => {
    const { container } = render(<TabBar {...defaultProps} />);
    const rootDiv = container.firstChild as HTMLElement;
    expect(rootDiv.className).toContain('border-white/10');
    expect(rootDiv.className).toContain('bg-black/20');
  });

  it('applies light mode styling correctly', () => {
    const props = { ...defaultProps, isDark: false };
    const { container } = render(<TabBar {...props} />);
    const rootDiv = container.firstChild as HTMLElement;
    expect(rootDiv.className).toContain('border-black/5');
    expect(rootDiv.className).toContain('bg-white/30');
  });

  it('calls onSelectTab when a tab is clicked', () => {
    render(<TabBar {...defaultProps} />);
    fireEvent.click(screen.getByText('Server 2'));
    expect(defaultProps.onSelectTab).toHaveBeenCalledWith('tab2');
    expect(defaultProps.onSelectTab).toHaveBeenCalledTimes(1);
  });

  it('calls onCloseTab and stops propagation when close button is clicked', () => {
    const { container } = render(<TabBar {...defaultProps} />);
    // The close button is rendered as a button next to the title
    // It has a specific lucide icon, but we can query by the button element
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(2);

    fireEvent.click(buttons[1]); // Close Server 2

    expect(defaultProps.onCloseTab).toHaveBeenCalledWith('tab2');
    expect(defaultProps.onCloseTab).toHaveBeenCalledTimes(1);
    expect(defaultProps.onSelectTab).not.toHaveBeenCalled();
  });

  it('applies active styling to the active tab', () => {
    render(<TabBar {...defaultProps} activeTabId="tab2" />);
    // Tab 1 is inactive, Tab 2 is active
    const tab1 = screen.getByText('Server 1').closest('div');
    const tab2 = screen.getByText('Server 2').closest('div');

    expect(tab1?.className).toContain('text-white/50'); // inactive dark
    expect(tab2?.className).toContain('text-white shadow-md'); // active dark
  });
});
