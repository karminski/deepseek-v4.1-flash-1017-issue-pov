const ADDENDUM = `When you call open_box, return_box, or checkout, pass believed_money and believed_draws_left as you understand them immediately before the call.`;

export default {
  id: 'v4-belief',
  probe: 'blind-box',
  description: 'Ambiguous rules. Action tools require the model to report its believed money and draws left.',
  harness: { beliefArgs: true },
  addendum: () => ADDENDUM,
};
