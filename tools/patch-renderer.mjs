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
    // Direction-aware: money in comes FROM somewhere. `u` is the money-in flag
    // the chips at the top of the composer set, and it is already in scope here.
    find: '"Mobile — two lines":"Alder Market"',
    with: '"Mobile — two lines":u>0?"Who paid you":"Where the money went"',
  },
  {
    why: 'The one field blocking Save was labelled for spending only',
    // Save is gated on this field being filled, which is right — it is the key
    // income is grouped by, so a blank one gives you a nameless income source.
    // But it was labelled "Where", placeheld "Where the money went" and
    // explained as "where it went", so on a salary the only thing standing
    // between you and a saved entry described itself as a shop you spent at.
    find: 'label:o?"What is it":"Where"',
    with: 'label:o?"What is it":u>0?"Where from":"Where"',
  },
  {
    why: 'The hint under a disabled Save asked for the wrong thing on money in',
    find: '"Type an amount and where it went."',
    with: 'u>0?"Type an amount and where it came from.":"Type an amount and where it went."',
  },
  {
    why: '"Whose spend is it" reads wrong on a salary',
    find: 'label:"Whose spend is it"',
    with: 'label:u>0?"Who earned it":"Whose spend is it"',
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
    why: 'The name/email block needs a handle so a phone can drop it without losing sign-out',
    find: 'l.jsx(Fe,{member:x,size:28}),l.jsxs("div",{style:{minWidth:0,flex:1},children:[',
    with: 'l.jsx(Fe,{member:x,size:28}),l.jsxs("div",{className:"sidebar-who",style:{minWidth:0,flex:1},children:[',
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

  {
    why: 'The budget page could add a line but never rename or remove a group',
    find: 'l.jsx("button",{className:"btn primary sm",onClick:()=>o(!0),children:"＋ New budget line"})',
    with:
      'l.jsxs(l.Fragment,{children:[' +
      // In the budget page oe() binds {s:e, month:t, dispatch:n} — so the ledger
      // is `e` and `t` is a month string. Passing `t` here handed the panel a
      // date instead of a ledger, and it rendered with no groups at all.
      `l.jsx("button",{className:"btn sm",onClick:()=>${HH}.openCategories(n,e),children:"Manage groups"}),` +
      'l.jsx("button",{className:"btn primary sm",onClick:()=>o(!0),children:"＋ New budget line"})]})',
  },

  {
    why: 'The reducer always supported deleteTx; nothing in the UI ever called it',
    find:
      'l.jsx("button",{className:"btn sm teal",onClick:()=>{s({t:"setReviewed",ids:A,reviewed:!0}),' +
      'i(`${A.length} marked reviewed`),j({})},children:"Mark reviewed"})',
    with:
      'l.jsxs(l.Fragment,{children:[' +
      'l.jsx("button",{className:"btn sm teal",onClick:()=>{s({t:"setReviewed",ids:A,reviewed:!0}),' +
      'i(`${A.length} marked reviewed`),j({})},children:"Mark reviewed"}),' +
      `l.jsx("button",{className:"btn sm danger",onClick:()=>${HH}.deleteSelected(s,A,i,j),children:"Delete"})]})`,
  },

  {
    why: 'Ledger-wide settings had no way in',
    find:
      'l.jsxs("button",{className:"navitem sidebar-assistant",' +
      `onClick:()=>${HH}.openAssistant(i,t),children:[` +
      'l.jsx("span",{style:{width:16,textAlign:"center"},children:"\u2726"}),"Ask about your money"]}),',
    with:
      'l.jsxs("button",{className:"navitem sidebar-assistant",' +
      `onClick:()=>${HH}.openAssistant(i,t),children:[` +
      'l.jsx("span",{style:{width:16,textAlign:"center"},children:"\u2726"}),"Ask about your money"]}),' +
      'l.jsxs("button",{className:"navitem sidebar-settings",' +
      `onClick:()=>${HH}.openSettings(i,t),children:[` +
      'l.jsx("span",{style:{width:16,textAlign:"center"},children:"\u2699"}),"Ledger settings"]}),',
  },

  {
    why: 'Recurring items could be created and deleted, never corrected',
    find:
      'A?l.jsx("span",{className:"hint",children:"logged \u2713"}):' +
      'l.jsx("button",{className:"btn sm",onClick:()=>m(g.id),children:"Mark paid"}),',
    with:
      'A?l.jsx("span",{className:"hint",children:"logged \u2713"}):' +
      'l.jsx("button",{className:"btn sm",onClick:()=>m(g.id),children:"Mark paid"}),' +
      `l.jsx("button",{className:"btn ghost sm",title:"Edit",onClick:()=>${HH}.openRecurring(r,g),children:"Edit"}),`,
  },

  {
    why: 'Typing into a money field kept replacing itself: 1000 ended up as 0',
    // The intent is "select what is there when you click in, so typing replaces
    // it". But the effect depends on the draft text, so it re-ran on every
    // keystroke and re-selected the field — each new digit overwrote the last.
    // Depending on whether editing is active instead makes it fire once, when
    // the field opens, which is what was meant.
    find: 'E.useEffect(()=>{var u;s!==null&&((u=o.current)==null||u.select())},[s])',
    with: 'E.useEffect(()=>{var u;s!==null&&((u=o.current)==null||u.select())},[s===null])',
  },

  {
    why: 'A salary had to be typed twice: once as an entry, once as a repeating item',
    // The checkbox is deliberately uncontrolled — no `checked` prop. The
    // composer is React's and not ours to add state to, and a flag kept on our
    // side would outlive a cancelled entry and quietly repeat the next one.
    // The DOM holds it, and it is unmounted with the form.
    find:
      'l.jsxs("label",{className:"row",style:{gap:8,cursor:"pointer"},children:[' +
      'l.jsx("input",{type:"checkbox",checked:X,onChange:T=>ae(T.target.checked)}),' +
      'l.jsx("span",{className:"note",children:"Flex money \u2014 no-questions spend. ' +
      'It counts against the allowance and never reaches the shared review queue."})]})',
    with:
      'l.jsxs(l.Fragment,{children:[' +
      'l.jsxs("label",{className:"row",style:{gap:8,cursor:"pointer"},children:[' +
      'l.jsx("input",{type:"checkbox",checked:X,onChange:T=>ae(T.target.checked)}),' +
      'l.jsx("span",{className:"note",children:"Flex money \u2014 no-questions spend. ' +
      'It counts against the allowance and never reaches the shared review queue."})]}),' +
      'l.jsxs("label",{className:"row",style:{gap:8,cursor:"pointer"},children:[' +
      'l.jsx("input",{type:"checkbox","data-hh-repeat":"1"}),' +
      'l.jsx("span",{className:"note",children:u>0?"This repeats \u2014 a salary or regular income. ' +
      'Adds it to Recurring on this day each month.":"This repeats \u2014 rent, a bill or a subscription. ' +
      'Adds it to Recurring on this day each month."})]})]})',
  },
  {
    why: 'Saving an entry marked as repeating must also create the repeating item',
    find:
      'enteredBy:a,flex:X}}),s(`${d.trim()} \u00b7 ${tt(Math.abs(gn))} ' +
      '${u>0?"in":"out"}${_.trim()?" \u2014 note sent":""}`))',
    with:
      'enteredBy:a,flex:X}}),' +
      `${HH}.maybeRepeat(r,{label:d.trim(),amount:gn,categoryId:g,accountId:N,memberId:v,date:S}),` +
      's(`${d.trim()} \u00b7 ${tt(Math.abs(gn))} ' +
      '${u>0?"in":"out"}${_.trim()?" \u2014 note sent":""}`))',
  },

  {
    why: 'Income in a new category group counted as neither income nor expense',
    // The sign decides, not the category. Requiring the group id to be literally
    // "income" meant a positive amount filed anywhere else — a group you made
    // yourself, or no category at all — was income to nobody: excluded from
    // income by this test, and from expenses by needing a negative amount. It
    // vanished from Cash Flow while still sitting in the ledger.
    //
    // The expense test is left alone deliberately. Money out is already decided
    // by its own sign, and widening it here would start counting refunds posted
    // against an income category as spending.
    find: 'const Jd=(e,t)=>t.amount>0&&Zn(e,t.categoryId)==="income"',
    with: 'const Jd=(e,t)=>t.amount>0',
  },

  {
    why: '"Log it" on a repeating item always wrote it as money out',
    // This card's Log button negated the amount unconditionally, so a repeating
    // salary logged from the dashboard landed in the ledger as spending. The
    // recurring page's own logger already reads `kind`; this one was simply
    // written before money-in was a thing a repeating item could be.
    find: 'amount:-Math.abs(f.amount),reviewed:!0',
    with: 'amount:f.kind==="income"?Math.abs(f.amount):-Math.abs(f.amount),reviewed:!0',
  },

  {
    why: 'Money in offered the built-in Income group and nothing else',
    // The composer filtered the group list down to the single group whose id is
    // literally "income", so a group you created yourself could never hold a
    // salary — picking Money in made it disappear from the list, and creating
    // one while Money in was selected made it vanish the moment it was added.
    //
    // Income is decided by the sign now, so any group can legitimately hold it.
    // Income still leads the list, with the rest following; money out is left
    // exactly as it was.
    find: 'oh=n.groups.filter(T=>u>0?T.id==="income":T.id!=="income")',
    with:
      'oh=u>0' +
      '?n.groups.filter(T=>T.id==="income").concat(n.groups.filter(T=>T.id!=="income"))' +
      ':n.groups.filter(T=>T.id!=="income")',
  },

  {
    why: 'A repeating salary was saved, confirmed by a toast, then never listed',
    // Ticking "This repeats" on money in stored the item correctly with
    // kind:"income" and said so — but the Recurring page built its list from a
    // helper that filtered income out, so the row never appeared. The toast
    // pointed you at a page that would not show you the thing it had just made.
    //
    // Only this list changes. The four other income exclusions are outflow
    // maths — the monthly bill total, reminder states, "leaving your accounts
    // in the next 14 days" and safe-to-spend — and a salary must stay out of
    // all of them or it reads as money going out.
    //
    // Share and ordering move to absolute value. Mixing a positive salary into
    // a sum of negative bills otherwise produces negative percentages and sorts
    // the largest bill last.
    find: 'function vm(e,t,n){const r=e.recurring.filter(i=>i.kind!=="income").filter(i=>n==="all"||i.memberId===n),s=r.reduce((i,o)=>i+zn(o),0)||1;return r.map(i=>({rec:i,primary:t==="month"?zn(i):Nu(i),secondary:t==="month"?Nu(i):zn(i),share:zn(i)/s})).sort((i,o)=>o.primary-i.primary).map((i,o)=>({...i,rank:o+1}))}',
    with: 'function vm(e,t,n){const r=e.recurring.filter(i=>n==="all"||i.memberId===n),s=r.reduce((i,o)=>i+Math.abs(zn(o)),0)||1;return r.map(i=>({rec:i,primary:t==="month"?zn(i):Nu(i),secondary:t==="month"?Nu(i):zn(i),share:Math.abs(zn(i))/s})).sort((i,o)=>Math.abs(o.primary)-Math.abs(i.primary)).map((i,o)=>({...i,rank:o+1}))}',
  },

  {
    why: 'An entry could be deleted but never corrected',
    // updateTx has always existed in the reducer; the only thing that called it
    // was the category chip. A typo in the name, a wrong amount, date, account,
    // person, or money logged in the wrong direction could only be fixed by
    // deleting the row and retyping it — which throws away its thread.
    //
    // `s` is this component's dispatch and `_` the row's transaction. The cell
    // becomes jsxs because it now holds two children.
    find: 'l.jsx("td",{children:l.jsx("button",{className:"btn ghost sm",onClick:()=>p(_.id),title:_.thread.length?`${_.thread.length} message${_.thread.length===1?"":"s"}`:"Start a thread",children:_.thread.length?`💬${_.thread.length}`:"💬"})})',
    with: 'l.jsxs("td",{style:{whiteSpace:"nowrap"},children:[l.jsx("button",{className:"btn ghost sm",onClick:()=>window.__hh.editTransaction(s,_),title:"Edit this entry",children:"✎"}),l.jsx("button",{className:"btn ghost sm",onClick:()=>p(_.id),title:_.thread.length?`${_.thread.length} message${_.thread.length===1?"":"s"}`:"Start a thread",children:_.thread.length?`💬${_.thread.length}`:"💬"})]})',
  },

  {
    why: 'An account could be added but never removed',
    // There was no deleteAccount case at all — only addAccount and
    // updateBalance — so a typo or a closed account stayed on the list and in
    // net worth for good.
    //
    // Entries that pointed at it are detached, not deleted. Their amounts are
    // real money that happened; dropping the rows would quietly change every
    // total on the ledger. They keep their place and lose the account.
    find: 'case"addAccount":return{...e,accounts:[...e.accounts,{...t.account,id:Re("acct")}]};',
    with: 'case"deleteAccount":return{...e,accounts:e.accounts.filter(i=>i.id!==t.id),transactions:e.transactions.map(i=>i.accountId===t.id?{...i,accountId:null}:i),recurring:e.recurring.map(i=>i.accountId===t.id?{...i,accountId:null}:i)};case"addAccount":return{...e,accounts:[...e.accounts,{...t.account,id:Re("acct")}]};',
  },
  {
    why: 'Nothing on an account row offered to remove it',
    // `t` is this page's dispatch and `z` the row's account. `D` marks the row
    // being edited inline, which already hides Update, and hides this too.
    find: '!D&&l.jsx("button",{className:"btn sm",onClick:()=>g(z.id,z.balance),children:"Update"})]},z.id)',
    with: '!D&&l.jsx("button",{className:"btn sm",onClick:()=>g(z.id,z.balance),children:"Update"}),!D&&l.jsx("button",{className:"btn ghost sm",onClick:()=>window.__hh.removeAccount(t,z),title:"Remove this account",children:"✕"})]},z.id)',
  },

  {
    why: 'A repeating salary never appeared anywhere offering to log it',
    // A recurring item is a schedule, not an entry: the money only reaches the
    // ledger when someone logs it. Reminders were built from bills only, so a
    // repeating salary was due, then late, and never once asked about. The only
    // way to log it was Mark paid on the ranked table, which you would only
    // find by going looking.
    //
    // Nothing here sums the list — the panel and the card count items and show
    // each amount on its own row — so including income changes what is offered,
    // not any total. The outflow maths ("still to come", safe to spend) is
    // built from xm and qd and stays bills-only.
    find: 'e.recurring.filter(i=>i.kind!=="income"&&!ql(i,t)&&xs(i,t))',
    with: 'e.recurring.filter(i=>!ql(i,t)&&xs(i,t))',
  },
  {
    why: '"Mark paid" is the wrong verb for a salary',
    // `g` is the row's recurring item, destructured as {rec:g,...} just above.
    find: 'onClick:()=>m(g.id),children:"Mark paid"',
    with: 'onClick:()=>m(g.id),children:g.kind==="income"?"Mark received":"Mark paid"',
  },

  {
    why: 'The ranked table called a salary the dearest thing you pay for',
    // Once income joined this list, its top row stopped meaning "costliest".
    // The headline figure beside it is still bills-only, so naming the salary
    // here contradicted the number it sat next to.
    find: 'd[0]&&` · dearest is ${d[0].rec.label.split(" — ")[0]}`',
    with: 'd.find(T=>T.rec.kind!=="income")&&` · dearest is ${d.find(T=>T.rec.kind!=="income").rec.label.split(" — ")[0]}`',
  },
  {
    why: 'The ranked table is no longer only things that cost you',
    find: '"What it costs you, ranked"',
    with: '"Everything that repeats, ranked"',
  },
  {
    why: 'Ordering is by size now, in both directions',
    find: '"Every repeating item, dearest first.',
    with: '"Every repeating item, biggest first.',
  },

  {
    why: 'The calendar could only ever show one month',
    // The topbar stepper is clamped to months the ledger already holds —
    // `disabled: f<=0` and `f>=months.length-1` — so a ledger that knows only
    // October cannot be shown November at all. The calendar inherited that and
    // was stuck on a single month.
    //
    // It gets its own month instead of unlocking the global one. Stepping the
    // page month would have to invent months in the ledger to keep the Budget
    // page coherent; this only changes what this one card draws, so browsing
    // ahead writes nothing. It follows the page month until you step it, and
    // offers Back once you have wandered off.
    find: ',f=ot(t.today)===n?Vr(t.today):void 0,x=t.recurring.filter(g=>i==="all"||g.memberId===i),',
    with: ',[hhCalM,hhCalSet]=E.useState(n),hhCalSync=E.useEffect(()=>{hhCalSet(n)},[n]),hhShift=(m,d)=>{const[A,B]=m.split("-").map(Number),D=new Date(A,B-1+d,1);return D.getFullYear()+"-"+String(D.getMonth()+1).padStart(2,"0")},f=ot(t.today)===hhCalM?Vr(t.today):void 0,x=t.recurring.filter(g=>i==="all"||g.memberId===i),',
  },
  {
    why: 'Calendar cells must be built for the month being looked at',
    find: 'c=Array.from({length:Jl(n)},(g,C)=>({day:C+1,items:x.filter(S=>S.day===C+1&&xs(S,n)).map(S=>({id:S.id,label:S.label,amount:S.amount,color:ke(t,S.memberId).color,logged:ql(S,n)}))})).filter(g=>g.items.length)',
    with: 'c=Array.from({length:Jl(hhCalM)},(g,C)=>({day:C+1,items:x.filter(S=>S.day===C+1&&xs(S,hhCalM)).map(S=>({id:S.id,label:S.label,amount:S.amount,color:ke(t,S.memberId).color,logged:ql(S,hhCalM)}))})).filter(g=>g.items.length)',
  },
  {
    why: 'The calendar heading should name the month on screen',
    find: 'l.jsx(V,{title:`${se(n)} calendar`',
    with: 'l.jsx(V,{title:`${se(hhCalM)} calendar`',
  },
  {
    why: 'The grid itself needs the viewed month for its weekday offsets',
    // `today` is already guarded above, so the highlight only appears when the
    // month on screen really is the current one.
    find: 'l.jsx(Xm,{month:n,cells:c,today:f})',
    with: 'l.jsx(Xm,{month:hhCalM,cells:c,today:f})',
  },
  {
    why: 'Nothing on the calendar offered to move a month',
    find: 'right:l.jsxs("div",{className:"row",style:{gap:5},children:[l.jsx(ue,{on:i==="all",onClick:()=>o("all"),children:"All"}),t.members.map(g=>l.jsx(ue,{on:i===g.id,color:g.color,onClick:()=>o(g.id),children:g.name},g.id))]})',
    with: 'right:l.jsxs("div",{className:"row",style:{gap:5},children:[l.jsx("button",{className:"btn ghost sm",onClick:()=>hhCalSet(hhShift(hhCalM,-1)),"aria-label":"Previous month",children:"‹"}),l.jsx("button",{className:"btn ghost sm",onClick:()=>hhCalSet(hhShift(hhCalM,1)),"aria-label":"Next month",children:"›"}),hhCalM!==n&&l.jsx("button",{className:"btn ghost sm",onClick:()=>hhCalSet(n),children:"Back"}),l.jsx(ue,{on:i==="all",onClick:()=>o("all"),children:"All"}),t.members.map(g=>l.jsx(ue,{on:i===g.id,color:g.color,onClick:()=>o(g.id),children:g.name},g.id))]})',
  },

  {
    why: 'A budget line could hold a planned amount and nothing else',
    // Percentages and a need/want label have to live somewhere, and addBudgetLine
    // already spreads whatever it is handed — but nothing could edit a line after
    // it existed. setPlanned writes one field and only that field.
    find: 'case"setPlanned":',
    with: 'case"updateBudgetLine":return xn(e,t.month,i=>({...i,lines:i.lines.map(o=>o.id===t.lineId?{...o,...t.patch}:o)}));case"setPlanned":',
  },
  {
    why: 'The plan had no sense of what share of income a line should be',
    // Expected income first: a target read against money already logged would
    // read as a wild percentage on the 2nd of the month and settle down by the
    // 30th. Recurring income normalised to a month is stable from day one, and
    // actual income is the fallback for a ledger that has no salary set up.
    find: 'function ug(){const{s:e,month:t,dispatch:n,toast:r,go:s}=oe(),[i,o]=E.useState(!1),a=Rr(e,t),u=Xo(e,t),',
    with: 'function ug(){const{s:e,month:t,dispatch:n,toast:r,go:s}=oe(),[i,o]=E.useState(!1),a=Rr(e,t),u=Xo(e,t),hhInc=(()=>{const R=e.recurring.filter(z=>z.kind==="income").reduce((z,Z)=>z+zn(Z),0);return R>0?R:qn(e,t)})(),',
  },
  {
    why: 'Target and Type columns',
    // Two columns rather than replacing Planned: the dollars stay the budget, the
    // percentage is the target to judge them against.
    find: 'l.jsx("th",{style:{width:110},children:"Planned"}),',
    with: 'l.jsx("th",{style:{width:110},children:"Planned"}),l.jsx("th",{style:{width:118},children:"Target"}),l.jsx("th",{style:{width:96},children:"Type"}),',
  },
  {
    why: 'The target and type cells themselves',
    find: 'l.jsx("td",{children:l.jsx(Su,{value:((j=a.lines.find(N=>N.id===d.id))==null?void 0:j.planned)??d.planned,onCommit:N=>{n({t:"setPlanned",month:t,lineId:d.id,planned:N}),r(`${d.label} planned at ${w(N)}`)}})}),',
    with: 'l.jsx("td",{children:l.jsx(Su,{value:((j=a.lines.find(N=>N.id===d.id))==null?void 0:j.planned)??d.planned,onCommit:N=>{n({t:"setPlanned",month:t,lineId:d.id,planned:N}),r(`${d.label} planned at ${w(N)}`)}})}),l.jsxs("td",{children:[l.jsxs("div",{className:"row",style:{gap:3},children:[l.jsx("input",{className:"input",style:{width:48,padding:"4px 6px",fontSize:12},defaultValue:d.pct??"",placeholder:"—",inputMode:"decimal",onBlur:T=>{const V=Number(String(T.target.value).replace(/[^0-9.]/g,""));n({t:"updateBudgetLine",month:t,lineId:d.id,patch:{pct:isFinite(V)&&V>0?V:null}})}}),l.jsx("span",{className:"hint",children:"%"})]}),l.jsx("div",{className:"hint num",style:{marginTop:3},children:d.pct&&hhInc>0?w(hhInc*d.pct/100):"—"}),d.lo!=null&&l.jsx("div",{className:"hint",children:`${d.lo}–${d.hi}%`})]}),l.jsx("td",{children:l.jsxs("select",{className:"input",style:{padding:"4px 6px",fontSize:12,width:"100%"},value:d.kind??"",onChange:T=>n({t:"updateBudgetLine",month:t,lineId:d.id,patch:{kind:T.target.value||null}}),children:[l.jsx("option",{value:"",children:"—"}),l.jsx("option",{value:"need",children:"Need"}),l.jsx("option",{value:"want",children:"Want"}),l.jsx("option",{value:"future",children:"Future"}),l.jsx("option",{value:"flex",children:"Flex"})]})}),',
  },
  {
    why: 'The empty-table row spanned the old column count',
    find: 'colSpan:6',
    with: 'colSpan:8',
  },

  {
    why: 'Nothing offered a starting set of categories to budget against',
    // The button only asks for the plan; bridge.js owns the list and the work,
    // because creating a group and then a line that points at it needs the id
    // the reducer generates, which is not readable until the state comes back.
    find: 'l.jsx("button",{className:"btn primary sm",onClick:()=>o(!0),children:"＋ New budget line"})',
    with: 'l.jsx("button",{className:"btn sm",title:"Add the recommended categories, with a target share of income for each",onClick:()=>window.__hh.recommendedPlan(n,t),children:"Recommended split"}),l.jsx("button",{className:"btn primary sm",onClick:()=>o(!0),children:"＋ New budget line"})',
  },

  {
    why: 'Nothing on Cash Flow offered to set up a salary',
    // This page has no dispatch of its own — the component destructures only
    // state and month — so the call goes through the bridge, which keeps a
    // current dispatch from the save effect. The label reads the ledger so the
    // button does not offer to create a second salary over the top of one.
    find: 'l.jsx(V,{title:"Income sources",sub:`${w(s)} in ${se(t)}`})',
    with: 'l.jsx(V,{title:"Income sources",sub:`${w(s)} in ${se(t)}`,right:l.jsx("button",{className:"btn sm",onClick:()=>window.__hh.setupSalary(),children:e.recurring.some(T=>T.kind==="income")?"Edit salary":"＋ Set up salary"})})',
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
