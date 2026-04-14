/**
 * Validates a standard 10-digit Indian Mobile Number (can optionally accept +91 prefix).
 */
export function isValidIndianPhoneNumber(phone: string): boolean {
  const phoneRegex = /^(?:\+91)?[6-9]\d{9}$/;
  return phoneRegex.test(phone.replace(/\s+/g, ''));
}

/**
 * Parses standard Indian License plates (e.g., MH 12 AB 1234 or DL 10 AA 1111)
 */
export function isValidIndianLicensePlate(plate: string): boolean {
  const plateRegex = /^[a-zA-Z]{2}[-\s]?[0-9]{2}[-\s]?[a-zA-Z]{1,2}[-\s]?[0-9]{4}$/;
  return plateRegex.test(plate.trim());
}

/**
 * Validates a National Highways Authority of India generated Project ID.
 * Expected Format: NHAI-STATECODE-YYYY-XXXX (e.g., NHAI-MH-2023-1452)
 */
export function isValidNHAIProjectId(projectId: string): boolean {
  const nhaiRegex = /^NHAI-[A-Z]{2}-\d{4}-\d{4}$/i;
  return nhaiRegex.test(projectId.trim());
}
