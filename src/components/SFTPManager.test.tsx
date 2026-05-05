// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SFTPManager, SFTPFile } from './SFTPManager';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: any) => {
      if (key === 'sftp.deleteConfirm') return `Delete ${params?.name}?`;
      return key;
    },
  }),
}));

const mockSftpList = vi.fn();
const mockSftpDelete = vi.fn();
const mockSftpEditSync = vi.fn();

const mockWindowConfirm = vi.fn();
const mockWindowAlert = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  cleanup(); // Clean up RTL before each test

  // Set up globals
  (global as any).window.electronAPI = {
    sftpList: mockSftpList,
    sftpDelete: mockSftpDelete,
    sftpEditSync: mockSftpEditSync,
  };
  (global as any).window.confirm = mockWindowConfirm;
  (global as any).window.alert = mockWindowAlert;
});

afterEach(() => {
  cleanup();
});

describe('SFTPManager', () => {
  const dummySessionId = 'session-123';
  const dummyFiles: SFTPFile[] = [
    { name: 'folder1', longname: 'drwxr-xr-x 2 user group 4096 Jan 1 00:00 folder1', type: 'd', size: 4096, mtime: 1672531200 },
    { name: 'file1.txt', longname: '-rw-r--r-- 1 user group 1024 Jan 1 00:00 file1.txt', type: '-', size: 1024, mtime: 1672531200 },
    { name: 'file2.jpg', longname: '-rw-r--r-- 1 user group 2048 Jan 1 00:00 file2.jpg', type: '-', size: 2048 * 1024, mtime: 1672531200 },
  ];

  it('renders and fetches root directory on mount', async () => {
    mockSftpList.mockResolvedValue({ success: true, list: [] });
    render(<SFTPManager sessionId={dummySessionId} isDark={true} />);

    expect(screen.getByText('sftp.title')).toBeDefined();

    await waitFor(() => {
      expect(mockSftpList).toHaveBeenCalledWith(dummySessionId, '/');
    });
  });

  it('displays files and formatting correctly', async () => {
    mockSftpList.mockResolvedValue({ success: true, list: dummyFiles });
    render(<SFTPManager sessionId={dummySessionId} isDark={true} />);

    await waitFor(() => {
      expect(screen.getByText('folder1')).toBeDefined();
      expect(screen.getByText('file1.txt')).toBeDefined();
      expect(screen.getByText('1 KB')).toBeDefined(); // file1.txt size
      expect(screen.getByText('2 MB')).toBeDefined(); // file2.jpg size
    });
  });

  it('displays error message when fetch fails', async () => {
    mockSftpList.mockResolvedValue({ success: false, error: 'Permission denied' });
    render(<SFTPManager sessionId={dummySessionId} isDark={true} />);

    await waitFor(() => {
      expect(screen.getByText('Permission denied')).toBeDefined();
    });
  });

  it('navigates into a folder when double-clicked', async () => {
    mockSftpList.mockResolvedValueOnce({ success: true, list: dummyFiles });
    render(<SFTPManager sessionId={dummySessionId} isDark={true} />);

    await waitFor(() => {
      expect(screen.getByText('folder1')).toBeDefined();
    });

    mockSftpList.mockResolvedValueOnce({ success: true, list: [] });
    fireEvent.doubleClick(screen.getByText('folder1').closest('tr')!);

    await waitFor(() => {
      expect(mockSftpList).toHaveBeenCalledWith(dummySessionId, '/folder1');
    });
  });

  it('navigates up when .. is clicked', async () => {
    // Initial fetch for /folder1
    mockSftpList.mockResolvedValueOnce({ success: true, list: dummyFiles });
    render(<SFTPManager sessionId={dummySessionId} isDark={true} />);

    await waitFor(() => {
      expect(screen.getByText('folder1')).toBeDefined();
    });

    // Navigate to /folder1
    mockSftpList.mockResolvedValueOnce({ success: true, list: [] });
    fireEvent.click(screen.getByText('folder1').closest('tr')!);

    await waitFor(() => {
      expect(mockSftpList).toHaveBeenCalledWith(dummySessionId, '/folder1');
      expect(screen.getByText('..')).toBeDefined();
    });

    // Navigate back to /
    mockSftpList.mockResolvedValueOnce({ success: true, list: dummyFiles });
    fireEvent.click(screen.getByText('..').closest('tr')!);

    await waitFor(() => {
      expect(mockSftpList).toHaveBeenCalledWith(dummySessionId, '/');
    });
  });

  it('deletes a file successfully after confirmation', async () => {
    mockSftpList.mockResolvedValueOnce({ success: true, list: dummyFiles });
    render(<SFTPManager sessionId={dummySessionId} isDark={true} />);

    await waitFor(() => {
      expect(screen.getByText('file1.txt')).toBeDefined();
    });

    mockWindowConfirm.mockReturnValue(true);
    mockSftpDelete.mockResolvedValue({ success: true });
    // Setup for refresh
    mockSftpList.mockResolvedValueOnce({ success: true, list: [dummyFiles[0], dummyFiles[2]] });

    const deleteButtons = screen.queryAllByRole('button');
    const deleteButtonForFile1 = deleteButtons.find(b => b.closest('tr')?.textContent?.includes('file1.txt'));
    expect(deleteButtonForFile1).toBeDefined();

    fireEvent.click(deleteButtonForFile1!);

    await waitFor(() => {
      expect(mockWindowConfirm).toHaveBeenCalledWith('Delete file1.txt?');
      expect(mockSftpDelete).toHaveBeenCalledWith(dummySessionId, '/file1.txt', false);
      expect(mockSftpList).toHaveBeenCalledWith(dummySessionId, '/'); // Refreshes directory
    });
  });

  it('shows alert when delete fails', async () => {
    mockSftpList.mockResolvedValueOnce({ success: true, list: dummyFiles });
    render(<SFTPManager sessionId={dummySessionId} isDark={true} />);

    await waitFor(() => {
      expect(screen.getByText('file1.txt')).toBeDefined();
    });

    mockWindowConfirm.mockReturnValue(true);
    mockSftpDelete.mockResolvedValue({ success: false, error: 'Cannot delete' });

    const deleteButtons = screen.queryAllByRole('button');
    const deleteButtonForFile1 = deleteButtons.find(b => b.closest('tr')?.textContent?.includes('file1.txt'));

    fireEvent.click(deleteButtonForFile1!);

    await waitFor(() => {
      expect(mockWindowConfirm).toHaveBeenCalledWith('Delete file1.txt?');
      expect(mockSftpDelete).toHaveBeenCalledWith(dummySessionId, '/file1.txt', false);
      expect(mockWindowAlert).toHaveBeenCalledWith('sftp.deleteFailedCannot delete');
    });
  });

  it('calls sftpEditSync when a file is double-clicked', async () => {
    mockSftpList.mockResolvedValueOnce({ success: true, list: dummyFiles });
    render(<SFTPManager sessionId={dummySessionId} isDark={true} />);

    await waitFor(() => {
      expect(screen.getByText('file1.txt')).toBeDefined();
    });

    mockSftpEditSync.mockResolvedValue({ success: true });
    fireEvent.doubleClick(screen.getByText('file1.txt').closest('tr')!);

    await waitFor(() => {
      expect(mockSftpEditSync).toHaveBeenCalledWith(dummySessionId, '/file1.txt');
    });
  });

  it('navigates via breadcrumb', async () => {
    // Initial fetch for /
    mockSftpList.mockResolvedValueOnce({ success: true, list: dummyFiles });
    render(<SFTPManager sessionId={dummySessionId} isDark={true} />);

    await waitFor(() => {
      expect(screen.getByText('folder1')).toBeDefined();
    });

    // Navigate to /folder1
    mockSftpList.mockResolvedValueOnce({ success: true, list: [] });
    fireEvent.click(screen.getByText('folder1').closest('tr')!);

    // We expect breadcrumbs for / and folder1
    await waitFor(() => {
      expect(screen.getByText('sftp.root')).toBeDefined();
      expect(screen.queryAllByText('folder1').length).toBeGreaterThan(0);
    });

    // Click root breadcrumb
    mockSftpList.mockResolvedValueOnce({ success: true, list: dummyFiles });
    fireEvent.click(screen.getByText('sftp.root'));

    await waitFor(() => {
      expect(mockSftpList).toHaveBeenCalledWith(dummySessionId, '/');
    });
  });
});
