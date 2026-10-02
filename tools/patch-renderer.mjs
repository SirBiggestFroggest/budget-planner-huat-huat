/** Rewrites the prototype's renderer bundle into the one the site ships.
 *
 *  The original Huat Huat source was lost; all that survived is the minified
 *  bundle in vendor/. Rather than hand-editing that file — which would make
 *  every future change an archaeology exercise — every edit lives here, as an
 *  explicit find/replace with a reason attached.
 *
 *      npm run patch
 *
 *  Each edit asserts it matched the expected number of times, so the build
 *  fails loudly instead of silently shipping a half-patched bundle.
 *
 *  Four kinds of edit:
 *    1. strip the demo ledger, so a new account starts empty and dated today
 *    2. never imply a partner exists until someone adds one
 *    3. survive an empty ledger
 *    4. hand sign-in, persistence and the profile editor to web/bridge.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'vendor', 'renderer-bundle.original.js');
const SOURCE_CSS = path.join(root, 'vendor', 'renderer-styles.original.css');
const OUT_DIR = path.join(root, 'web', 'assets');
const TARGET = path.join(OUT_DIR, 'index-DceXRptG.js');
const TARGET_CSS = path.join(OUT_DIR, 'index-DIOxbhdo.css');

// `window.__hh` is defined by web/bridge.js, which loads first.
const HH = 'window.__hh';
const DOT = '·'; // ·
const BULLET = '●'; // ●
const CAT = String.fromCodePoint(0x1f408); // 🐈

const edits = [
  // == 1. no demo data ======================================================
  {
    why: "Version the storage key so the prototype's demo ledger is never read again",
    find: 'const Xd="huat-huat.ledger.v1"',
    with: 'const Xd="huat-huat.ledger.v2"',
  },
  {
    why: 'Replace the seeded demo ledger with an empty account',
    find:
      'function bl(){return{members:Bp,accounts:Hp,groups:ju,categories:Yd,' +
      'transactions:Xp,recurring:Zp,goals:qp,holdings:tm,dividends:rm,shares:lm,' +
      'budgets:Qi.map(e=>({month:e,rollover:!1,lines:ju.filter(t=>t.id!=="income")' +
      '.map(t=>({id:"bl_"+e+"_"+t.id,groupId:t.id,label:t.label,color:t.color,' +
      'planned:Qp[t.id]??0})),flex:[{memberId:"nia",allowance:400},' +
      '{memberId:"theo",allowance:450}]})),checkins:[],session:null,months:Qi,today:ys}}',
    with: `function bl(){return ${HH}.freshState()}`,
  },
  {
    why: '"Today" was frozen at the date the prototype was built',
    find: 'ys="2026-09-18"',
    with: `ys=${HH}.today()`,
  },
  {
    why: 'Months were pinned to the demo quarter; start at the real month',
    find: 'Qi=["2026-07","2026-08","2026-09"]',
    with: `Qi=${HH}.months()`,
  },
  {
    why: 'Drop the demo full-name lookup so members show their own names',
    find: 'xu={nia:"Nia Okonjo",theo:"Theo Nelson"}',
    with: 'xu={}',
  },
  {
    why: '"Today" is saved inside the ledger, so a stored one must be re-dated on load',
    find: '?bl():r}catch{return bl()}}',
    with: `?bl():${HH}.rehydrate(r)}catch{return bl()}}`,
  },
  {
    why: "Sidebar showed the demo household's home town",
    find: `children:"Merged ${DOT} Portland, OR"`,
    with: 'children:"Merged ledger"',
  },
  {
    why: 'Merchant field suggested a shop from the demo ledger',
    find: '"Mobile — two lines":"Alder Market"',
    with: '"Mobile — two lines":"Where the money went"',
  },
  {
    why: 'Account fields suggested a bank invented for the demo',
    find: 'placeholder:"Alder Bank"',
    with: 'placeholder:"Your bank"',
    count: 2,
  },

  // == 2. no partner until there is one =====================================
  //
  // The prototype was hardwired for a named couple. A ledger with one person on
  // it should never render a second person's name, an empty column under it, or
  // a split that implies someone to split with.
  {
    why: 'Entry note placeholder named a partner who may not exist',
    find: 'placeholder:v==="theo"?"Note for Nia (optional)":"Note for Theo (optional)"',
    with: `placeholder:${HH}.notePlaceholder(n,v)`,
  },
  {
    why: 'Dashboard header counted entries per person',
    find: '`${N.count} entries in ${se(n)} ' + DOT + ' Nia wrote ${N.byNia}, Theo wrote ${N.byTheo}`',
    with: `\`\${N.count} entries in \${se(n)}\${${HH}.wroteSuffix(t,N)}\``,
  },
  {
    why: 'Dashboard spending bar always had a partner segment',
    find:
      'parts:[{value:x.nia,color:"var(--nia)",label:"Nia"},' +
      '{value:x.theo,color:"var(--theo)",label:"Theo"},' +
      '{value:x.joint,color:"var(--joint)",label:"Joint"}]',
    with: `parts:${HH}.spendParts(t,x)`,
  },
  {
    why: 'Dashboard spending legend always listed a partner',
    find:
      `children:[l.jsxs("span",{children:[l.jsx("b",{style:{color:"var(--nia)"},children:"${BULLET}"})," Nia ",w(x.nia)]}),` +
      `l.jsxs("span",{children:[l.jsx("b",{style:{color:"var(--theo)"},children:"${BULLET}"})," Theo ",w(x.theo)]}),` +
      `l.jsxs("span",{children:[l.jsx("b",{style:{color:"var(--joint)"},children:"${BULLET}"})," Joint bills ",w(x.joint)]})]`,
    with:
      `children:[l.jsxs("span",{children:[l.jsx("b",{style:{color:"var(--nia)"},children:"${BULLET}"}),\` \${${HH}.meName(t)} \`,w(x.nia)]}),` +
      `...(${HH}.hasPartner(t)?[l.jsxs("span",{children:[l.jsx("b",{style:{color:"var(--theo)"},children:"${BULLET}"}),\` \${${HH}.partnerName(t)} \`,w(x.theo)]})]:[]),` +
      `l.jsxs("span",{children:[l.jsx("b",{style:{color:"var(--joint)"},children:"${BULLET}"})," Joint bills ",w(x.joint)]})]`,
  },
  {
    why: 'Transactions stat tile counted entries per person',
    find: 'note:`Nia ${$.byNia} ' + DOT + ' Theo ${$.byTheo}`',
    with: `note:${HH}.wroteNote(t,$)`,
  },
  {
    why: 'Recurring "who pays" always reserved three columns',
    find:
      '("div",{style:{display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:10},children:' +
      '[["Nia paid",N.nia,"var(--nia)"],["Theo paid",N.theo,"var(--theo)"],' +
      '["Joint account",N.joint,"var(--joint)"]].map(([b,A,z])=>',
    with:
      `("div",{style:{display:"grid",gridTemplateColumns:"repeat("+${HH}.paidRows(e,N).length+", 1fr)",gap:10},children:` +
      `${HH}.paidRows(e,N).map(([b,A,z])=>`,
  },
  {
    why: 'Check-in spending bar always had a partner segment',
    find:
      'parts:[{value:d.nia,color:"var(--nia)",label:"Nia"},' +
      '{value:d.theo,color:"var(--theo)",label:"Theo"},' +
      '{value:d.joint,color:"var(--joint)",label:"Joint"}]',
    with: `parts:${HH}.spendParts(e,d)`,
  },
  {
    why: 'Check-in card breakdown always listed a partner',
    find:
      `children:[l.jsxs("span",{children:["Nia's cards ",w(d.nia)]}),` +
      `l.jsxs("span",{children:["Theo's cards ",w(d.theo)]}),` +
      `l.jsxs("span",{children:["Joint account ",w(d.joint)]})]`,
    with:
      `children:[l.jsxs("span",{children:[\`\${${HH}.meName(e)}'s cards \`,w(d.nia)]}),` +
      `...(${HH}.hasPartner(e)?[l.jsxs("span",{children:[\`\${${HH}.partnerName(e)}'s cards \`,w(d.theo)]})]:[]),` +
      `l.jsxs("span",{children:["Joint account ",w(d.joint)]})]`,
  },
  {
    why: 'Goal funding offered splits that need two people',
    find: 'children:Zm.map(([z,O])=>l.jsx(ue,{on:y===z,onClick:()=>v(z),children:O},z))',
    with: `children:${HH}.splitOptions(t).map(([z,O])=>l.jsx(ue,{on:y===z,onClick:()=>v(z),children:O},z))`,
  },
  {
    why: 'Goal funding hint named both people',
    find: '`Nia ${w($[0])} ' + DOT + ' Theo ${w($[1])} ',
    with: `\`\${${HH}.fundingSplit(t,[w($[0]),w($[1])])} `,
  },
  {
    why: 'Goals contribution-share note named the demo pair',
    find: 'note:`Nia ${Math.round(o.niaShare*100)}% ' + DOT + ' Theo ${Math.round(o.theoShare*100)}%',
    with:
      `note:\`\${${HH}.meName(e)} \${Math.round(o.niaShare*100)}% ${DOT} ` +
      `\${${HH}.partnerName(e)} \${Math.round(o.theoShare*100)}%`,
  },
  {
    why: 'Goal deadline toast named the demo pair',
    find: '`${u.label} ' + DOT + ' Nia ${w(N)} + Theo ${w(p)} meets ',
    with: `\`\${u.label} ${DOT} \${${HH}.meName(e)} \${w(N)} + \${${HH}.partnerName(e)} \${w(p)} meets `,
  },
  {
    why: 'The per-person lens is meaningless with only one person on the ledger',
    find:
      'l.jsx("div",{className:"seg",children:[["all","Both"],...r.members.filter(d=>d.kind==="person")' +
      '.map(d=>[d.id,d.name])].map(([d,y])=>l.jsx("button",{"aria-pressed":o===d,onClick:()=>a(d),children:y},d))})',
    with:
      `${HH}.hasPartner(r)&&l.jsx("div",{className:"seg",children:[["all","Both"],...r.members.filter(d=>d.kind==="person")` +
      '.map(d=>[d.id,d.name])].map(([d,y])=>l.jsx("button",{"aria-pressed":o===d,onClick:()=>a(d),children:y},d))})',
  },

  // == 3. survive an empty ledger ===========================================
  // The prototype always had demo accounts, so both composers picked a default
  // by reading accounts[0] outright. On a fresh ledger that threw and took the
  // whole app down with it.
  {
    why: 'Entry composer crashed when no account exists yet',
    find: '??n.accounts[0].id)',
    with: '??(n.accounts.length?n.accounts[0].id:null))',
  },
  {
    why: 'Holding composer crashed when no account exists yet',
    find: '??t.accounts[0].id)',
    with: '??(t.accounts.length?t.accounts[0].id:null))',
  },

  // == 4. hand off to the bridge ============================================
  {
    why: 'Give the bridge the live ledger and dispatch on every change, for sync',
    find: 'E.useEffect(()=>{am(e)},[e])',
    with: `E.useEffect(()=>{am(e),${HH}.onState(e,t)},[e])`,
  },
  {
    why: 'Replace the mock account picker with real Supabase Google sign-in',
    find:
      'onClick:()=>r("google"),children:[l.jsx("span",{style:{fontWeight:700,' +
      'color:"#4285F4"},children:"G"})," Continue with Google"]',
    with:
      `onClick:()=>${HH}.googleSignIn(t),children:[l.jsx("span",{style:{fontWeight:700,` +
      'color:"#4285F4"},children:"G"})," Continue with Google"]',
  },
  {
    why: 'The sign-in link was never actually sent; Supabase now really sends one',
    find: 'onClick:()=>r("sent"),children:"Email me a sign-in link"',
    with: `onClick:()=>${HH}.emailSignIn(t,s),children:"Email me a sign-in link"`,
  },
  {
    why: 'Add profile editing, and sign out of Supabase after flushing the last write',
    find:
      'l.jsx("button",{className:"btn ghost sm",style:{color:"var(--dark-ink-2)"},' +
      'onClick:()=>i({t:"signOut"}),children:"Sign out"})',
    with:
      'l.jsxs(l.Fragment,{children:[l.jsx("button",{className:"btn ghost sm",' +
      `style:{color:"var(--dark-ink-2)"},onClick:()=>${HH}.openProfile(i,t),children:"Edit"}),` +
      'l.jsx("button",{className:"btn ghost sm",style:{color:"var(--dark-ink-2)"},' +
      `onClick:()=>${HH}.signOut(i),children:"Sign out"})]})`,
  },
  {
    why: 'Sidebar showed a hardcoded version',
    find: `l.jsx("div",{style:{fontSize:10,color:"#6B6452",padding:"0 6px"},children:"v1 ${DOT} manual"})`,
    with: `l.jsx("div",{className:"sidebar-version",children:${HH}.versionLabel()})`,
  },

  // --- classes the stylesheet needs to reach ------------------------------
  {
    why: 'The sidebar foot was hidden exactly when the window got too narrow to spare it',
    find: 'l.jsxs("div",{className:"only-wide",style:{display:"grid",gap:8},children:[',
    with: 'l.jsxs("div",{className:"sidebar-foot",style:{display:"grid",gap:8},children:[',
  },
  {
    why: 'Share button needs a handle for the compact top bar',
    find: 'l.jsxs("button",{className:"navitem",onClick:()=>a(!0),children:[',
    with: 'l.jsxs("button",{className:"navitem sidebar-share",onClick:()=>a(!0),children:[',
  },
  {
    why: 'Account row needs a handle, and its inline border belongs in the stylesheet',
    find:
      'x&&l.jsxs("div",{className:"row",style:{borderTop:"1px solid var(--dark-line)",paddingTop:10,gap:9},children:[',
    with: 'x&&l.jsxs("div",{className:"row sidebar-account",children:[',
  },

  // --- entry points for sharing and the assistant -------------------------
  {
    why: "The prototype's share modal was a mock whose invite link went nowhere",
    find: 'l.jsxs("button",{className:"navitem sidebar-share",onClick:()=>a(!0),children:[',
    with: `l.jsxs("button",{className:"navitem sidebar-share",onClick:()=>${HH}.openSharing(i,t),children:[`,
  },
  {
    why: 'Give the assistant a way in, beside sharing',
    find: '"Share this ledger"]}),',
    with:
      '"Share this ledger"]}),' +
      'l.jsxs("button",{className:"navitem sidebar-assistant",' +
      `onClick:()=>${HH}.openAssistant(i,t),children:[` +
      'l.jsx("span",{style:{width:16,textAlign:"center"},children:"✦"}),"Ask about your money"]}),',
  },

  // --- the logo -----------------------------------------------------------
  // Both logos were the 🐈 emoji, which Windows renders as an orange tabby —
  // nothing like the app's own black cat.
  {
    why: 'Sidebar logo was an emoji rather than the cat artwork',
    find: `placeItems:"center",flex:"none",fontSize:20},children:"${CAT}"})`,
    with: `placeItems:"center",flex:"none",overflow:"hidden"},children:l.jsx("img",{className:"hh-logo",src:${HH}.logo,alt:""})})`,
  },
  {
    why: 'Sign-in logo was an emoji rather than the cat artwork',
    find: `display:"grid",placeItems:"center",fontSize:26},children:"${CAT}"})`,
    with: `display:"grid",placeItems:"center",overflow:"hidden"},children:l.jsx("img",{className:"hh-logo",src:${HH}.logo,alt:""})})`,
  },
];

// ---------------------------------------------------------------------------

let src = fs.readFileSync(SOURCE, 'utf8');
const failures = [];

for (const edit of edits) {
  const expected = edit.count ?? 1;
  const count = src.split(edit.find).length - 1;
  if (count !== expected) {
    failures.push(`${count} matches (expected ${expected}) for: ${edit.why}\n    ${edit.find.slice(0, 110)}`);
    continue;
  }
  src = src.split(edit.find).join(edit.with);
}

if (failures.length) {
  console.error(`\npatch-renderer: ${failures.length} edit(s) did not apply:\n`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(TARGET, src, 'utf8');
fs.copyFileSync(SOURCE_CSS, TARGET_CSS);

const rel = (p) => p.replace(root + path.sep, '').replace(/\\/g, '/');
console.log(`patch-renderer: applied ${edits.length} edits`);
console.log(`  ${rel(SOURCE)} -> ${rel(TARGET)}`);
console.log(`  ${rel(SOURCE_CSS)} -> ${rel(TARGET_CSS)}`);

// A last sweep: nothing the user can reach should mention the demo household.
const leftovers = ['Nia Okonjo', 'Theo Nelson', 'Alder Bank', 'nia.okonjo', 'theo.nelson', '2026-09-18'];
const survived = leftovers.filter((s) => src.includes(s));
if (survived.length) {
  // These live on in seed arrays the reducer no longer reaches — dead weight,
  // not a bug — but the list should stay short.
  console.log(`  note: unreferenced demo strings remain in dead code: ${survived.join(', ')}`);
}
