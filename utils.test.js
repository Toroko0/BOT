const utils = require('./utils');

describe('Utils Module', () => {
  describe('calculateDaysLeft', () => {
    test('returns 180 when daysOwned is 0', () => {
      expect(utils.calculateDaysLeft(0)).toBe(180);
    });

    test('returns correct days left for positive daysOwned', () => {
      expect(utils.calculateDaysLeft(30)).toBe(150);
      expect(utils.calculateDaysLeft(179)).toBe(1);
    });

    test('never returns negative days left', () => {
      expect(utils.calculateDaysLeft(200)).toBe(0);
    });

    test('handles string input', () => {
      expect(utils.calculateDaysLeft('60')).toBe(120);
    });

    test('handles invalid input as 0', () => {
      expect(utils.calculateDaysLeft('abc')).toBe(180);
      expect(utils.calculateDaysLeft(null)).toBe(180);
      expect(utils.calculateDaysLeft(undefined)).toBe(180);
    });
  });

  describe('calculateExpiryDate', () => {
    test('returns a future date based on daysOwned', () => {
      const now = new Date();
      const expiry = utils.calculateExpiryDate(0);
      expect(expiry).toBeInstanceOf(Date);
      expect(expiry.getTime()).toBeGreaterThanOrEqual(now.getTime());
    });

    test('expiry date decreases as daysOwned increases', () => {
      const expiry180 = utils.calculateExpiryDate(0);
      const expiry90 = utils.calculateExpiryDate(90);
      const expiry179 = utils.calculateExpiryDate(179);

      expect(expiry180.getTime()).toBeGreaterThan(expiry90.getTime());
      expect(expiry90.getTime()).toBeGreaterThan(expiry179.getTime());
    });
  });
});
