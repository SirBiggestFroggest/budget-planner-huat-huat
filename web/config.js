/** Huat Huat · deployment configuration.
 *
 *  Both values belong in the page. The publishable key identifies the project;
 *  it does not grant access. What actually protects the data is the row level
 *  security in supabase/schema.sql, which ties every row to the signed-in user.
 *
 *  Never put a `sb_secret_...` / `service_role` key here: those bypass RLS and
 *  would hand every ledger to anyone who views source.
 */
window.HUAT_CONFIG = {
  supabaseUrl: 'https://yhavcmsvwksjeaaeqwyv.supabase.co',
  supabaseAnonKey: 'sb_publishable_kkg-sLVTcsKbUf1VzuJdRA_5W4BKuNz',
};
