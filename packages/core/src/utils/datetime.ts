/**
 * Calculates a Service Level Agreement (SLA) breach date by adding 'allowedDays' 
 * sequentially to the start date, intentionally skipping weekends (Saturday/Sunday).
 * @param startDateUnix Unix timestamp in milliseconds
 * @param allowedDays Number of working days safely allowed
 * @returns Projected SLA breach Unix timestamp
 */
export function calculateSLABreachDate(startDateUnix: number, allowedDays: number): number {
  const currentDate = new Date(startDateUnix);
  let daysAdded = 0;

  while (daysAdded < allowedDays) {
    currentDate.setDate(currentDate.getDate() + 1);
    const dayOfWeek = currentDate.getDay();
    
    // Skip Saturdays (6) and Sundays (0)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      daysAdded++;
    }
  }

  return currentDate.getTime();
}

/**
 * Indian Financial Year runs from April 1st of YYYY to March 31st of YYYY+1.
 * Determines if a specific timestamp belongs to the passed Financial Year.
 * @param timestampUnix Unix timestamp in milliseconds
 * @param financialYearStart E.g., pass 2023 to check against FY 2023-2024
 */
export function isWithinFinancialYear(timestampUnix: number, financialYearStart: number): boolean {
  const queryDate = new Date(timestampUnix);
  
  const fyStartDate = new Date(financialYearStart, 3, 1); // April 1st, YYYY
  const fyEndDate = new Date(financialYearStart + 1, 2, 31, 23, 59, 59); // March 31st, YYYY+1

  return queryDate >= fyStartDate && queryDate <= fyEndDate;
}
