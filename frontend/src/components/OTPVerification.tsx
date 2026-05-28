import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

type Props = {
  phoneNumber: string;
  sessionId: string;
  expiresAt: string;
  attemptsRemaining: number;
  onVerify: (code: string) => Promise<boolean>;
  onResend: () => Promise<boolean>;
  loading?: boolean;
  error?: string | null;
};

export default function OTPVerification({
  phoneNumber,
  sessionId,
  expiresAt,
  attemptsRemaining,
  onVerify,
  onResend,
  loading = false,
  error = null
}: Props) {
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [timeLeft, setTimeLeft] = useState(0);
  const [canResend, setCanResend] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Calculate time remaining
  useEffect(() => {
    const updateTimer = () => {
      const now = new Date().getTime();
      const expires = new Date(expiresAt).getTime();
      const remaining = Math.max(0, Math.floor((expires - now) / 1000));
      
      setTimeLeft(remaining);
      setCanResend(remaining === 0);
      
      if (remaining > 0) {
        setTimeout(updateTimer, 1000);
      }
    };

    updateTimer();
  }, [expiresAt]);

  const handleInputChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return; // Only allow digits

    const newCode = [...code];
    newCode[index] = value.slice(-1); // Take only the last digit
    setCode(newCode);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all digits are entered
    if (newCode.every(digit => digit !== '') && !loading) {
      handleVerify(newCode.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const newCode = [...code];
    
    for (let i = 0; i < pastedData.length && i < 6; i++) {
      newCode[i] = pastedData[i];
    }
    
    setCode(newCode);
    
    // Focus the next empty input or the last input
    const nextEmptyIndex = newCode.findIndex(digit => digit === '');
    const focusIndex = nextEmptyIndex === -1 ? 5 : nextEmptyIndex;
    inputRefs.current[focusIndex]?.focus();

    // Auto-submit if complete
    if (newCode.every(digit => digit !== '')) {
      handleVerify(newCode.join(''));
    }
  };

  const handleVerify = async (otpCode: string) => {
    const success = await onVerify(otpCode);
    if (!success) {
      // Clear the code on failure
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    }
  };

  const handleResend = async () => {
    if (canResend && !loading) {
      const success = await onResend();
      if (success) {
        setCode(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const maskedPhone = phoneNumber.replace(/(\+\d{2})(\d{4})(\d+)/, '$1****$3');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="text-center">
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="material-symbols-outlined text-blue-600 text-[32px]">sms</span>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Verify Your Phone</h2>
        <p className="text-gray-600">
          We've sent a 6-digit code to <span className="font-medium">{maskedPhone}</span>
        </p>
      </div>

      {/* OTP Input */}
      <div className="space-y-4">
        <div className="flex justify-center gap-3">
          {code.map((digit, index) => (
            <input
              key={index}
              ref={el => inputRefs.current[index] = el}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={e => handleInputChange(index, e.target.value)}
              onKeyDown={e => handleKeyDown(index, e)}
              onPaste={handlePaste}
              disabled={loading}
              className={`w-12 h-12 text-center text-xl font-bold border-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                error ? 'border-red-300 bg-red-50' : 'border-gray-300 focus:border-blue-500'
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            />
          ))}
        </div>

        {/* Error Message */}
        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3"
          >
            {error}
            {attemptsRemaining > 0 && (
              <div className="mt-1 text-xs">
                {attemptsRemaining} attempt{attemptsRemaining !== 1 ? 's' : ''} remaining
              </div>
            )}
          </motion.div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center">
            <div className="inline-flex items-center gap-2 text-blue-600">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              <span className="text-sm">Verifying...</span>
            </div>
          </div>
        )}
      </div>

      {/* Timer and Resend */}
      <div className="text-center space-y-3">
        {timeLeft > 0 ? (
          <p className="text-gray-600 text-sm">
            Code expires in <span className="font-medium text-blue-600">{formatTime(timeLeft)}</span>
          </p>
        ) : (
          <p className="text-red-600 text-sm font-medium">Code has expired</p>
        )}

        <button
          onClick={handleResend}
          disabled={!canResend || loading}
          className={`text-sm font-medium transition-colors ${
            canResend && !loading
              ? 'text-blue-600 hover:text-blue-800 cursor-pointer'
              : 'text-gray-400 cursor-not-allowed'
          }`}
        >
          {loading ? 'Sending...' : 'Resend Code'}
        </button>
      </div>

      {/* Manual Submit Button */}
      <button
        onClick={() => handleVerify(code.join(''))}
        disabled={code.some(digit => digit === '') || loading}
        className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Verifying...' : 'Verify Code'}
      </button>
    </motion.div>
  );
}