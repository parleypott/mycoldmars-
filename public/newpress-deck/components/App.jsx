// Tweaks panel + logic
const { useState, useEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "colorTheme": "paper",
  "density": "medium",
  "fontPair": "serif-mono",
  "coverVariant": "A",
  "problemVariant": "A",
  "fifteenVariant": "A",
  "teamVariant": "A",
  "closeVariant": "A",
  "hiddenSlides": []
}/*EDITMODE-END*/;

const SLIDES_LIST = [
  {key: "cover",       label: "01 · Cover"},
  {key: "problem",     label: "02 · Problem"},
  {key: "impact",      label: "03 · Impact"},
  {key: "solution",    label: "04 · Solution"},
  {key: "how",         label: "05 · How It Works"},
  {key: "reimagining", label: "06 · Reimagining"},
  {key: "working",     label: "07 · It's Working"},
  {key: "fifteen",     label: "08 · 15M Subscribers"},
  {key: "playbook",    label: "09 · Playbook"},
  {key: "expansion",   label: "10 · Expansion"},
  {key: "economics",   label: "11 · Economics"},
  {key: "market",      label: "12 · Market"},
  {key: "opportunity", label: "13 · The Opportunity"},
  {key: "future",      label: "14 · What's Next"},
  {key: "team",        label: "15 · Team"},
  {key: "close",       label: "16 · Closing"},
];

const TweaksPanel = ({ state, setState, open }) => {
  const update = (patch) => {
    const next = {...state, ...patch};
    setState(next);
    try { window.parent.postMessage({type: '__edit_mode_set_keys', edits: patch}, '*'); } catch(e){}
  };
  const toggleHidden = (key) => {
    const set = new Set(state.hiddenSlides);
    if (set.has(key)) set.delete(key); else set.add(key);
    update({hiddenSlides: [...set]});
  };

  const OptRow = ({label, value, options, onChange}) => (
    <div className="tp-group">
      <div className="tp-label">{label}</div>
      <div className="tp-options">
        {options.map(o => (
          <button key={o.v} className="tp-opt" data-active={value === o.v}
            onClick={() => onChange(o.v)}>{o.l}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="tweaks-panel" data-open={open}>
      <h3>Tweaks</h3>
      <div className="tp-kicker">Newpress · Pitch Deck 2026</div>

      <OptRow label="Color theme" value={state.colorTheme}
        options={[{v:"paper",l:"Paper"},{v:"ink",l:"Ink"},{v:"burgundy",l:"Burgundy"}]}
        onChange={v => update({colorTheme: v})}/>

      <OptRow label="Density" value={state.density}
        options={[{v:"sparse",l:"Sparse"},{v:"medium",l:"Medium"},{v:"dense",l:"Dense"}]}
        onChange={v => update({density: v})}/>

      <OptRow label="Font pair" value={state.fontPair}
        options={[{v:"serif-mono",l:"Serif + Mono"},{v:"serif-sans",l:"Serif + Sans"},{v:"all-serif",l:"All Serif"}]}
        onChange={v => update({fontPair: v})}/>

      <OptRow label="Cover variant" value={state.coverVariant}
        options={[{v:"A",l:"A · Editorial"},{v:"B",l:"B · Ink + Burgundy"},{v:"C",l:"C · Symmetric"}]}
        onChange={v => update({coverVariant: v})}/>

      <OptRow label="Problem variant" value={state.problemVariant}
        options={[{v:"A",l:"A · Paper"},{v:"B",l:"B · Burgundy"}]}
        onChange={v => update({problemVariant: v})}/>

      <OptRow label="15M slide variant" value={state.fifteenVariant}
        options={[{v:"A",l:"A · Stats grid"},{v:"B",l:"B · Big Number"}]}
        onChange={v => update({fifteenVariant: v})}/>

      <OptRow label="Team variant" value={state.teamVariant}
        options={[{v:"A",l:"A · 5 + advisors"},{v:"B",l:"B · 8-up grid"}]}
        onChange={v => update({teamVariant: v})}/>

      <OptRow label="Closing variant" value={state.closeVariant}
        options={[{v:"A",l:"A · Ink"},{v:"B",l:"B · Paper"}]}
        onChange={v => update({closeVariant: v})}/>

      <div className="tp-group">
        <div className="tp-label">Swap in / out slides</div>
        <div style={{display:'flex', flexDirection:'column', gap: 4, maxHeight: 180, overflowY:'auto', border:'1px solid var(--np-rule-faint)', padding: 8}}>
          {SLIDES_LIST.map(s => (
            <label key={s.key} className="tp-toggle-row">
              <input type="checkbox" checked={!state.hiddenSlides.includes(s.key)}
                onChange={() => toggleHidden(s.key)}/>
              <span>{s.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const [state, setState] = useState(TWEAK_DEFAULTS);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === '__activate_edit_mode') setPanelOpen(true);
      if (d.type === '__deactivate_edit_mode') setPanelOpen(false);
    };
    window.addEventListener('message', onMsg);
    try { window.parent.postMessage({type:'__edit_mode_available'}, '*'); } catch(e){}
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    document.body.setAttribute('data-color-theme', state.colorTheme);
    document.body.setAttribute('data-density', state.density);
    document.body.setAttribute('data-font-pair', state.fontPair);
  }, [state.colorTheme, state.density, state.fontPair]);

  // Build active slide list based on variants + hidden
  const isVisible = (key) => !state.hiddenSlides.includes(key);

  const coverMap = { A: Slide01_CoverA, B: Slide01_CoverB, C: Slide01_CoverC };
  const problemMap = { A: Slide02_ProblemA, B: Slide02_ProblemB };
  const fifteenMap = { A: Slide08_FifteenMA, B: Slide08_FifteenMB };
  const teamMap = { A: Slide14_TeamA, B: Slide14_TeamB };
  const closeMap = { A: Slide15_CloseA, B: Slide15_CloseB };

  const slideDefs = [
    { key: "cover",       Comp: coverMap[state.coverVariant] || Slide01_CoverA },
    { key: "problem",     Comp: problemMap[state.problemVariant] || Slide02_ProblemA },
    { key: "impact",      Comp: Slide03_Impact },
    { key: "solution",    Comp: Slide04_Solution },
    { key: "how",         Comp: Slide05_HowItWorks },
    { key: "reimagining", Comp: Slide06_Reimagining },
    { key: "working",     Comp: Slide07_ItsWorking },
    { key: "fifteen",     Comp: fifteenMap[state.fifteenVariant] || Slide08_FifteenMA },
    { key: "playbook",    Comp: Slide09_Playbook },
    { key: "expansion",   Comp: Slide10_Expansion },
    { key: "economics",   Comp: Slide11_CapitalEff },
    { key: "market",      Comp: Slide12_Market },
    { key: "opportunity", Comp: Slide12b_Opportunity },
    { key: "future",      Comp: Slide13_Future },
    { key: "team",        Comp: teamMap[state.teamVariant] || Slide14_TeamA },
    { key: "close",       Comp: closeMap[state.closeVariant] || Slide15_CloseA },
  ];

  const active = slideDefs.filter(s => isVisible(s.key));
  const total = active.length;

  return (
    <React.Fragment>
      <deck-stage width="1920" height="1080">
        {active.map((s, i) => (
          <s.Comp key={s.key} num={i+1} total={total} />
        ))}
      </deck-stage>
      <TweaksPanel state={state} setState={setState} open={panelOpen}/>
    </React.Fragment>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
