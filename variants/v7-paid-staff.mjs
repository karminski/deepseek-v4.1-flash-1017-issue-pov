export default {
  id: 'v7-paid-staff',
  probe: 'blind-box',
  description: 'Same as v0, but each ask_staff question costs 1 yuan from the same 100 yuan. The cost is stated in the prompt and the tool description.',
  harness: { paidStaff: true },
  addendum: () => '',
};
