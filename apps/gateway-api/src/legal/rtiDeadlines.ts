export type RtiDeadlineInput = {
  countryCode: string;
  submittedAt: Date;
  // Optional flags; keep minimal until we model special RTI categories.
  isLifeOrLiberty?: boolean;
};

export type RtiDeadlines = {
  responseDueAt: Date;
  // If the government misses the due date, citizens typically have a window to appeal.
  firstAppealLastDate: Date;
  // Some jurisdictions have a second-level appeal; kept optional and conservative.
  secondAppealLastDate?: Date;
  basis: {
    countryCode: string;
    responseDays: number;
    firstAppealWindowDays: number;
    secondAppealWindowDays?: number;
  };
};

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function calculateRtiDeadlines(input: RtiDeadlineInput): RtiDeadlines {
  const countryCode = input.countryCode.toUpperCase();

  // NOTE: This is a simple calendar-day calculator. Jurisdiction-specific rules
  // (holidays/weekends/service-by-post) should be layered on later.
  if (countryCode === 'IN') {
    // India RTI Act: commonly 30 days; 48 hours for life/liberty.
    const responseDays = input.isLifeOrLiberty ? 2 : 30;
    const firstAppealWindowDays = 30;

    const responseDueAt = addDays(input.submittedAt, responseDays);
    const firstAppealLastDate = addDays(responseDueAt, firstAppealWindowDays);

    // Second appeal is often 90 days from FAA order; we don’t have FAA order date yet.
    return {
      responseDueAt,
      firstAppealLastDate,
      basis: {
        countryCode,
        responseDays,
        firstAppealWindowDays
      }
    };
  }

  // Default fallback: 30-day response + 30-day appeal window.
  const responseDays = 30;
  const firstAppealWindowDays = 30;
  const responseDueAt = addDays(input.submittedAt, responseDays);
  const firstAppealLastDate = addDays(responseDueAt, firstAppealWindowDays);

  return {
    responseDueAt,
    firstAppealLastDate,
    basis: {
      countryCode,
      responseDays,
      firstAppealWindowDays
    }
  };
}
