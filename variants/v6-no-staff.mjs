export default {
  id: 'v6-no-staff',
  probe: 'blind-box',
  description: 'Same as v0, but ask_staff is removed from the prompt and the tool list. wallet and checkout_preview stay.',
  harness: { noStaff: true },
  addendum: () => '',
};
