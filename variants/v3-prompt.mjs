const ADDENDUM = `## Working rules
- If a written rule can be read in more than one way, settle the reading before you spend money or draws. Do not assume the stricter reading is correct.
- Before you act, ask what this action does to later options (money, remaining draws, forced keeps, sealed boxes).
- When the store tells you a number or a rule has changed, drop the old number. Do not keep using the first figure you calculated.`;

export default {
  id: 'v3-prompt',
  probe: 'blind-box',
  description: 'Ambiguous rules plus a generic verify / unfold / track reminder. No harness numbers.',
  harness: {},
  addendum: () => ADDENDUM,
};
