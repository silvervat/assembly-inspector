import { Toaster } from 'react-hot-toast';

export function ToastContainer() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: '#1e293b',
          color: '#f1f5f9',
          fontSize: '13px',
          borderRadius: '8px',
          padding: '8px 16px',
        },
        success: {
          iconTheme: { primary: '#10b981', secondary: '#f1f5f9' },
        },
        error: {
          iconTheme: { primary: '#ef4444', secondary: '#f1f5f9' },
          duration: 6000,
        },
      }}
    />
  );
}
