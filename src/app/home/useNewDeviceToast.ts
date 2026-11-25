import React from 'react';

/**
 * The toast shown when the 3D mouse layer reports an input device it has not
 * seen before: which device, whether the toast is showing, and the timer that
 * hides it after nine seconds. Moved out of Home verbatim.
 */
export function useNewDeviceToast() {
  'use no memo';
  const [newDeviceToast, setNewDeviceToast] = React.useState<string | null>(null);
  const [isNewDeviceToastVisible, setIsNewDeviceToastVisible] = React.useState(false);
  const newDeviceToastTimeoutRef = React.useRef<number | null>(null);

  const handleNewDeviceDetected = React.useCallback((deviceId: string) => {
    setNewDeviceToast(deviceId);
    setIsNewDeviceToastVisible(true);
    if (newDeviceToastTimeoutRef.current !== null) {
      window.clearTimeout(newDeviceToastTimeoutRef.current);
    }
    newDeviceToastTimeoutRef.current = window.setTimeout(() => {
      setIsNewDeviceToastVisible(false);
      newDeviceToastTimeoutRef.current = null;
    }, 9000);
  }, []);

  React.useEffect(() => {
    return () => {
      if (newDeviceToastTimeoutRef.current !== null) {
        window.clearTimeout(newDeviceToastTimeoutRef.current);
      }
    };
  }, []);

  return {
    newDeviceToast,
    isNewDeviceToastVisible,
    setIsNewDeviceToastVisible,
    handleNewDeviceDetected,
  };
}
