import { LightningElement, api, track, wire } from 'lwc';
import { getRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import CATALOG_METADATA_ID from '@salesforce/label/c.Product_Catalog_Metadata_Id';
import runAnalysis from '@salesforce/apex/TomraSiteImageAnalyzer.runAnalysis';
import runRecommendation from '@salesforce/apex/TomraSiteRecommender.runRecommendation';

// ── Demo fixture — simulates a full LLM response for Screen 2 prefill ─────────
// KEEP IN SYNC WITH the *Options arrays below — all IDs must match opt.id values
const DEMO_ANALYSIS = {
    confidence: 91,
    recommendedLayout: 'Medium Tunnel',
    containerTypes: ['Cans', 'Plastic Bottles', 'Glass Bottles'],
    performanceTier: 'High Volume',
    hardwareAddons: ['Additional T9 Unit'],
    softwareAddons: ['TOMRA Digital Platform', 'Analytics & Reporting Dashboard'],
    implementationServices: ['Installation Service', 'Store Layout & Design'],
    trainingServices: ['Staff Training'],
    supportServices: ['Preventive Maintenance — Basic'],
    reasoning: 'The space dimensions comfortably accommodate a Medium Tunnel configuration with dual-stream processing. Glass bottle acceptance and high-volume throughput are recommended based on the visible store footprint. An additional T9 unit is advised given the expected daily container volume.',
    warnings: ['Ensure floor drainage is available within 1m of installation footprint.'],
    suggestSiteSurvey: false,
};

// ── Demo fixture — simulates recommender output for Screen 3 ───────────────────
const DEMO_RECOMMENDATION = {
    title: 'R1 Medium Tunnel High-Volume Bundle',
    subtitle: 'Medium tunnel RVM with high-volume throughput, dual-stream, and digital analytics',
    confidence: 81,
    reasoning: 'The Medium Tunnel layout supports cans, plastic, and glass with adequate throughput for a high-volume site. The additional T9 unit augments sorting capacity, and the digital platform with analytics enables remote monitoring and performance insights.',
    warnings: ['Ensure floor drainage is available within 1m of installation footprint.'],
    suggestSiteSurvey: false,
    recommendedProducts: [
        {
            id: 'R1-MED',
            quantity: 1,
            justification: 'Selected as the core unit because the layout is Medium Tunnel and no crate handling is required.'
        },
        {
            id: 'T9-ADD',
            quantity: 1,
            justification: 'Included to increase throughput since the site is high volume and accepts more than two container types.'
        },
        {
            id: 'SW-DIG',
            quantity: 1,
            justification: 'Required for remote monitoring and as a dependency for the analytics dashboard.'
        },
        {
            id: 'SW-ANL',
            quantity: 1,
            justification: 'Provides advanced analytics and reporting to optimize operations.'
        },
        {
            id: 'SVC-INST',
            quantity: 1,
            justification: 'Mandatory because a hardware add-on is included.'
        },
        {
            id: 'SVC-LAY',
            quantity: 1,
            justification: 'Supports site planning to maintain consumer flow and fit the Medium Tunnel footprint.'
        },
        {
            id: 'SVC-TRN',
            quantity: 1,
            justification: 'Required when the Digital Platform is included to ensure proper operation and hygiene practices.'
        },
        {
            id: 'SVC-MNT-BAS',
            quantity: 1,
            justification: 'Provides annual preventive maintenance with remote diagnostics aligned with the selected support tier.'
        }
    ]
};

// ── Module-level constants ─────────────────────────────────────────────────────
const TAG_LABELS  = { required: 'Core', addon: 'Add-on', service: 'Service', software: 'Software' };
const TAG_CLASSES = { required: 'tag tag-required', addon: 'tag tag-addon', service: 'tag tag-service', software: 'tag tag-software' };

// Maps data-group attribute values to their @track property names.
// If a group key is missing here, _groupProp() will throw explicitly rather than
// silently returning undefined and causing a hard-to-debug assignment failure.
const GROUP_MAP = {
    layout:         'layoutOptions',
    containers:     'containerOptions',
    performance:    'performanceOptions',
    hardware:       'hardwareOptions',
    software:       'softwareOptions',
    implementation: 'implementationOptions',
    training:       'trainingOptions',
    support:        'supportOptions',
};

// Demo dimensions pre-populated so screen 2 never shows empty values in demo mode
const DEMO_DIMENSIONS = { width: 4.5, height: 2.8, depth: 3.2 };

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeOption(id, label, note = null) {
    return { id, label, note, selected: false, btnClass: 'opt-btn', checkClass: 'opt-check' };
}

function applySelected(opt, selected) {
    return {
        ...opt,
        selected,
        btnClass:   selected ? 'opt-btn selected' : 'opt-btn',
        checkClass: selected ? 'opt-check selected' : 'opt-check',
    };
}

// Uses en-GB locale so thousands separator is a comma and € symbol is prefix —
// readable for English-speaking reps while remaining correct for EUR amounts.
// Example: 12500 → "€12,500.00"
function formatEur(amount) {
    const safeAmount = Number(amount) || 0;
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(safeAmount);
}

function generateQuoteRef() {
    return 'QUO-' + Math.floor(10000 + Math.random() * 90000);
}

// Returns a Promise that resolves after `ms` milliseconds.
// Store the returned { promise, timeoutId } so the timeout can be cancelled.
function delay(ms) {
    let timeoutId;
    const promise = new Promise(resolve => {
        timeoutId = setTimeout(resolve, ms);
    });
    return { promise, timeoutId };
}

// ── Shape validators for Apex JSON responses ──────────────────────────────────
// These guards protect component state from malformed or unexpected LLM output.
// They throw on bad shape so the existing .catch() blocks handle it gracefully.

function validateAnalysisShape(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('Analysis response is not an object');
    if ('confidence' in obj && typeof obj.confidence !== 'number') throw new Error('confidence must be a number');
    if ('recommendedLayout' in obj && typeof obj.recommendedLayout !== 'string') throw new Error('recommendedLayout must be a string');
    if ('containerTypes' in obj && !Array.isArray(obj.containerTypes)) throw new Error('containerTypes must be an array');
    if ('performanceTier' in obj && typeof obj.performanceTier !== 'string') throw new Error('performanceTier must be a string');
    if ('hardwareAddons' in obj && !Array.isArray(obj.hardwareAddons)) throw new Error('hardwareAddons must be an array');
    if ('softwareAddons' in obj && !Array.isArray(obj.softwareAddons)) throw new Error('softwareAddons must be an array');
    if ('implementationServices' in obj && !Array.isArray(obj.implementationServices)) throw new Error('implementationServices must be an array');
    if ('trainingServices' in obj && !Array.isArray(obj.trainingServices)) throw new Error('trainingServices must be an array');
    if ('supportServices' in obj && !Array.isArray(obj.supportServices)) throw new Error('supportServices must be an array');
    if ('warnings' in obj && !Array.isArray(obj.warnings)) throw new Error('warnings must be an array');
}

function validateRecommendationShape(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('Recommendation response is not an object');
    if ('confidence' in obj && typeof obj.confidence !== 'number') throw new Error('confidence must be a number');
    if ('title' in obj && typeof obj.title !== 'string') throw new Error('title must be a string');
    if ('subtitle' in obj && typeof obj.subtitle !== 'string') throw new Error('subtitle must be a string');
    if ('reasoning' in obj && typeof obj.reasoning !== 'string') throw new Error('reasoning must be a string');
    if ('warnings' in obj && !Array.isArray(obj.warnings)) throw new Error('warnings must be an array');
    if (!Array.isArray(obj.recommendedProducts)) throw new Error('recommendedProducts must be an array');
    obj.recommendedProducts.forEach((p, i) => {
        if (!p || typeof p !== 'object') throw new Error(`recommendedProducts[${i}] is not an object`);
        if (typeof p.id !== 'string') throw new Error(`recommendedProducts[${i}].id must be a string`);
        if ('quantity' in p && typeof p.quantity !== 'number') throw new Error(`recommendedProducts[${i}].quantity must be a number`);
    });
}

// ── Component ─────────────────────────────────────────────────────────────────
export default class TomraSiteAssessment extends LightningElement {

    @api recordId;

    // isDemoMode is a plain property — @track not needed for primitives in modern LWC
    isDemoMode = false;

    // ── Pending timeout IDs — cleared in disconnectedCallback ─────────────────
    _pendingTimeouts = [];

    // Cancellation flag — set to true when goBack() is called mid-load or on
    // disconnect, so in-flight Apex .then() blocks do not advance the screen.
    // FIX: _cancelPendingWork() no longer re-arms this to false itself.
    // The flag is only ever reset to false at the top of each async operation
    // (_runImageAnalysis, _runRecommendation), ensuring any already-queued
    // microtasks from a cancelled Promise.all see the flag correctly.
    _cancelled = false;

    // ── Demo pill getters ─────────────────────────────────────────────────────
    get demoPillClass()      { return 'demo-pill' + (this.isDemoMode ? ' demo-pill-on' : ''); }
    get demoPillTrackClass() { return 'demo-pill-track' + (this.isDemoMode ? ' demo-pill-track-on' : ''); }
    get demoPillThumbClass() { return 'demo-pill-thumb' + (this.isDemoMode ? ' demo-pill-thumb-on' : ''); }

    // ── Catalog ──────────────────────────────────────────────────────────────
    // catalogData is static JSON written once at load — the wire will not update
    // it after the component mounts in normal usage. If this ever changes (e.g.
    // heavy org automation updates the field mid-session), add a currentScreen
    // guard here to avoid clobbering in-progress recommendations.
    @track catalogData = [];

    @wire(getRecord, { recordId: CATALOG_METADATA_ID, fields: ['Product_Catalog__mdt.Product_Catalog_JSON__c'] })
    wiredRecord({ data, error }) {
        if (data) {
            const raw = data.fields.Product_Catalog_JSON__c.value;
            console.log('Raw product JSON from Custom Metadata: ' + raw);
            if (raw) {
                try {
                    const decoded = raw.replace(/&quot;/g, '"')
                                    .replace(/&amp;/g, '&')
                                    .replace(/&#39;/g, "'")
                                    .replace(/&lt;/g, '<')
                                    .replace(/&gt;/g, '>');
                    this.catalogData = JSON.parse(decoded);
                } catch (e) {
                    console.error('[TOMRA] Invalid JSON in Product_Catalog__mdt', e);
                    this.catalogData = [];
                }
            } else {
                this.catalogData = [];
            }
        }
        if (error) {
            console.error('[TOMRA] Could not read Product_Catalog__mdt record', error);
            this.catalogData = [];
        }
    }

    get catalogReady()    { return this.catalogData.length > 0; }
    get catalogNotReady() { return !this.catalogReady; }
    get catalogEmptyMessage() {
        return this.recordId
            ? 'No product catalog found. Make sure the Custom Metadata - Product Catalog is populated.'
            : 'Open this component from an Opportunity record to load the product catalog.';
    }

    // ── Photo / file state ────────────────────────────────────────────────────
    @track uploadedFiles = [];
    @track photoError    = null;

    get acceptedFormats()  { return ['.jpg', '.jpeg', '.png', '.heic', '.webp']; }
    get uploadedCount()    { return this.uploadedFiles.length; }
    get hasUploadedFiles() { return this.uploadedFiles.length > 0; }

    get uploadedFileList() {
        return this.uploadedFiles.map((f, i) => ({
            index: i,
            name:  f.name,
            label: `Photo ${i + 1} — ${f.name}`,
        }));
    }

    handleUploadFinished(event) {
        const files = event.detail.files;
        if (!files || !files.length) return;

        files.forEach(f => {
            if (this.uploadedFiles.length >= 3) return;

            const alreadyExists = this.uploadedFiles.some(existing => existing.contentDocumentId === f.documentId);
            if (alreadyExists) return;

            const previewUrl = '/sfc/servlet.shepherd/document/download/' + f.documentId;
            this.uploadedFiles = [
                ...this.uploadedFiles,
                {
                    contentDocumentId: f.documentId,
                    name: f.name,
                    previewUrl
                }
            ];
        });

        console.log('All uploaded files so far:', JSON.stringify(this.uploadedFiles, null, 2));
        this.photoError = null;
    }

    handleDemoToggle() {
        this.isDemoMode = !this.isDemoMode;
        // Pre-populate dimensions so screen 2 never shows empty values in demo mode
        if (this.isDemoMode) {
            this.dimensions = { ...DEMO_DIMENSIONS };
        } else {
            this.dimensions = { width: '', height: '', depth: '' };
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    disconnectedCallback() {
        // Cancel all pending timeouts to prevent callbacks firing on a dead component
        this._cancelled = true;
        this._pendingTimeouts.forEach(id => clearTimeout(id));
        this._pendingTimeouts = [];
    }

    // ── State ─────────────────────────────────────────────────────────────────
    @track currentScreen  = 1;
    @track isLoading      = false;
    @track loadingTitle   = 'Work in Progress';
    @track assessmentRef  = 'ASS-' + Math.floor(1000 + Math.random() * 9000);
    @track quoteRef       = generateQuoteRef();
    @track aiPrefilled    = false;
    @track aiAnalysis     = null;

    // FIX: @track added to dimensions and siteDetails so that any future direct
    // property mutation (e.g. this.dimensions.width = x) triggers re-render.
    // Spread-based reassignment already worked in modern LWC, but decorating
    // explicitly is consistent with the rest of the state declarations and
    // prevents a subtle footgun for future maintainers.
    @track dimensions     = { width: '', height: '', depth: '' };
    @track siteDetails    = { storeName: 'Tesco Extra – Wembley', city: 'London', notes: '' };

    @track layoutOptions = [
        makeOption('Short Tunnel',  'Short Tunnel',  'No crates'),
        makeOption('Medium Tunnel', 'Medium Tunnel', null),
        makeOption('Long Tunnel',   'Long Tunnel',   'Crate handling'),
    ];
    @track containerOptions = [
        makeOption('Cans',            'Cans'),
        makeOption('Plastic Bottles', 'Plastic Bottles'),
        makeOption('Glass Bottles',   'Glass Bottles'),
        makeOption('Crates',          'Crates'),
    ];
    @track performanceOptions = [
        makeOption('Standard',    'Standard',    '≤45 /min'),
        makeOption('High Volume', 'High Volume', '≤60 /min'),
    ];
    @track hardwareOptions = [
        makeOption('Additional T9 Unit',        'Additional T9 Unit'),
        makeOption('Additional Cabinet Module', 'Additional Cabinet Module'),
    ];
    @track softwareOptions = [
        makeOption('TOMRA Digital Platform',          'TOMRA Digital Platform',          'Subscription'),
        makeOption('Analytics & Reporting Dashboard', 'Analytics & Reporting Dashboard', null),
        makeOption('API / Integration Package',       'API / Integration Package',       null),
    ];
    @track implementationOptions = [
        makeOption('Installation Service',  'Installation Service'),
        makeOption('Store Layout & Design', 'Store Layout & Design'),
    ];
    @track trainingOptions = [
        makeOption('Staff Training', 'Staff Training'),
    ];
    @track supportOptions = [
        makeOption('Preventive Maintenance — Basic',   'Preventive Maintenance — Basic'),
        makeOption('Preventive Maintenance — Premium', 'Preventive Maintenance — Premium'),
        makeOption('Extended Warranty',                'Extended Warranty'),
    ];

    @track recommendedProducts = [];
    @track recommendation      = { title: '', subtitle: '', confidence: 0, reasoning: '', warnings: [], suggestSiteSurvey: false };
    @track quoteTotals         = { hardware: '€0', software: '€0', services: '€0', grand: '€0' };
    @track loadingSteps        = [];

    // ── Computed ──────────────────────────────────────────────────────────────
    get isScreen1() { return this.currentScreen === 1 && !this.isLoading; }
    get isScreen2() { return this.currentScreen === 2 && !this.isLoading; }
    get isScreen3() { return this.currentScreen === 3 && !this.isLoading; }
    get isScreen4() { return this.currentScreen === 4 && !this.isLoading; }

    get confirmPerformanceTier() {
        const selected = this.performanceOptions.find(o => o.selected);
        return selected ? selected.label : '—';
    }

    get headerSubtitle() {
        if (this.isLoading) return this.loadingTitle + '…';
        const map = {
            1: 'Site Photos & Dimensions',
            2: 'System Configuration',
            3: 'Product Recommendation',
            4: 'Quote Confirmed'
        };
        return map[this.currentScreen] || '';
    }

    get showBack()  { return (this.currentScreen > 1 && this.currentScreen < 4) && !this.isLoading; }

    get nextButtonLabel() {
        if (this.currentScreen === 1) return 'Configure Quote';
        if (this.currentScreen === 2) return 'Generate Recommendations';
        if (this.currentScreen === 3) return 'Create Quote';
        return '';
    }

    get nextDisabled() {
        if (this.isDemoMode) return this.catalogNotReady;
        return this.catalogNotReady || this.uploadedFiles.length === 0;
    }

    get hasWarnings() {
        return this.recommendation.warnings && this.recommendation.warnings.length > 0;
    }

    // ── Confirmation screen computed ──────────────────────────────────────────
    get confirmSiteName() {
        const name = this.siteDetails.storeName;
        const city = this.siteDetails.city;
        if (name && city) return `${name}, ${city}`;
        if (name) return name;
        if (city) return city;
        return '—';
    }

    get confirmLayout() {
        const selected = this.layoutOptions.find(o => o.selected);
        return selected ? selected.label : '—';
    }

    get confirmProductCount() {
        const count = this.recommendedProducts.length;
        return count === 1 ? '1 product' : `${count} products`;
    }

    get showSlot2() { return this.uploadedFiles.length < 2; }
    get showSlot3() { return this.uploadedFiles.length < 3; }

    // ── Progress step getters ─────────────────────────────────────────────────
    get step1DotClass()   { return this._dotClass(1); }
    get step2DotClass()   { return this._dotClass(2); }
    get step3DotClass()   { return this._dotClass(3); }
    get step1LabelClass() { return this._labelClass(1); }
    get step2LabelClass() { return this._labelClass(2); }
    get step3LabelClass() { return this._labelClass(3); }
    get step1Label()      { return this.currentScreen > 1 ? '✓' : '1'; }
    get step2Label()      { return this.currentScreen > 2 ? '✓' : '2'; }
    get step3Label()      { return this.currentScreen > 3 ? '✓' : '3'; }
    get line1Class()      { return 'step-line' + (this.currentScreen > 1 ? ' completed' : ''); }
    get line2Class()      { return 'step-line' + (this.currentScreen > 2 ? ' completed' : ''); }

    _dotClass(n) {
        if (n < this.currentScreen) return 'step-dot completed';
        if (n === this.currentScreen && this.currentScreen < 4) return 'step-dot active';
        if (this.currentScreen === 4) return 'step-dot completed';
        return 'step-dot inactive';
    }

    _labelClass(n) {
        return 'step-label' + (n === this.currentScreen ? ' active' : '');
    }

    // ── Handlers ──────────────────────────────────────────────────────────────
    handleDimensionChange(event) {
        const field = event.target.dataset.field;
        this.dimensions = { ...this.dimensions, [field]: parseFloat(event.target.value) || 0 };
    }

    handleSiteDetailChange(event) {
        const field = event.target.dataset.field;
        this.siteDetails = { ...this.siteDetails, [field]: event.target.value };
    }

    // FIX: _groupProp() throws on an unknown data-group value, which would
    // previously surface as an unhandled exception and could crash the component
    // subtree in production. Both handlers now catch that throw and show a toast
    // instead, keeping the component alive and giving the rep a clear signal.
    handleSingleSelect(event) {
        try {
            const prop = this._groupProp(event.currentTarget.dataset.group);
            const id   = event.currentTarget.dataset.id;
            this[prop] = this[prop].map(opt => applySelected(opt, opt.id === id));
        } catch (e) {
            console.error(e);
            this.dispatchEvent(new ShowToastEvent({
                title: 'Selection error',
                message: e.message,
                variant: 'error',
            }));
        }
    }

    handleMultiSelect(event) {
        try {
            const prop = this._groupProp(event.currentTarget.dataset.group);
            const id   = event.currentTarget.dataset.id;
            this[prop] = this[prop].map(opt => opt.id !== id ? opt : applySelected(opt, !opt.selected));
        } catch (e) {
            console.error(e);
            this.dispatchEvent(new ShowToastEvent({
                title: 'Selection error',
                message: e.message,
                variant: 'error',
            }));
        }
    }

    // Resolves the @track property name for a given data-group attribute value.
    // Throws explicitly if the group key is not in GROUP_MAP so mismatches are
    // caught immediately rather than silently assigning to undefined.
    _groupProp(group) {
        const prop = GROUP_MAP[group];
        if (!prop) {
            throw new Error(`[TOMRA] Unknown option group: "${group}". Add it to GROUP_MAP.`);
        }
        return prop;
    }

    // ── Restart ───────────────────────────────────────────────────────────────
    handleRestart() {
        // Cancel any in-flight async work before resetting state
        this._cancelPendingWork();

        this.currentScreen  = 1;
        this.isLoading      = false;
        this.isDemoMode     = false;  // reset demo mode on restart
        this.assessmentRef  = 'ASS-' + Math.floor(1000 + Math.random() * 9000);
        this.quoteRef       = generateQuoteRef();
        this.aiPrefilled    = false;
        this.aiAnalysis     = null;
        this.uploadedFiles  = [];
        this.photoError     = null;
        this.dimensions     = { width: '', height: '', depth: '' };
        this.siteDetails    = { storeName: '', city: '', notes: '' };
        this.recommendedProducts = [];
        this.recommendation = { title: '', subtitle: '', confidence: 0, reasoning: '', warnings: [], suggestSiteSurvey: false };
        this.quoteTotals    = { hardware: '€0', software: '€0', services: '€0', grand: '€0' };
        this.dimensionError = null;

        const resetOptions = opts => opts.map(o => applySelected(o, false));
        this.layoutOptions         = resetOptions(this.layoutOptions);
        this.containerOptions      = resetOptions(this.containerOptions);
        this.performanceOptions    = resetOptions(this.performanceOptions);
        this.hardwareOptions       = resetOptions(this.hardwareOptions);
        this.softwareOptions       = resetOptions(this.softwareOptions);
        this.implementationOptions = resetOptions(this.implementationOptions);
        this.trainingOptions       = resetOptions(this.trainingOptions);
        this.supportOptions        = resetOptions(this.supportOptions);
    }

    // ── Cancellation helper ───────────────────────────────────────────────────
    // Call this before navigating back or on disconnect to stop any in-flight
    // Apex promises from advancing the screen after the user has moved away.
    //
    // FIX: Removed the previous `this._cancelled = false` re-arm at the end of
    // this method. Re-arming here created a race: if a Promise.all had already
    // resolved (microtask queued) before goBack() called this method, the
    // microtask would run after the re-arm and see _cancelled === false,
    // advancing the screen despite the user having navigated away.
    //
    // _cancelled is now only ever reset to false at the very top of
    // _runImageAnalysis and _runRecommendation, immediately before new async
    // work begins — at that point any prior microtasks have already settled.
    _cancelPendingWork() {
        this._cancelled = true;
        this._pendingTimeouts.forEach(id => clearTimeout(id));
        this._pendingTimeouts = [];
    }

    // Registers a timeout ID so it can be cancelled if needed.
    // Returns the underlying Promise so callers can await it.
    _scheduleStep(ms) {
        const { promise, timeoutId } = delay(ms);
        this._pendingTimeouts.push(timeoutId);
        return promise;
    }

    // ── Navigation ────────────────────────────────────────────────────────────
    goNext() {
        // FIX: Guard against double-submit. Without this, a fast double-click
        // while the spinner is running on screens 2 or 3 would call
        // _runRecommendation() or _pushToCpq() a second time, creating two
        // concurrent async chains writing to the same @track state. Screen 1
        // was already protected by nextDisabled; screens 2 and 3 were not.
        if (this.isLoading) return;

        if (this.currentScreen === 1) {
            if (this.nextDisabled) return;

            if (!this.isDemoMode) {
                const { width, height, depth } = this.dimensions;
                if (!width || !height || !depth || width <= 0 || height <= 0 || depth <= 0) {
                    this.dimensionError = 'Please enter valid Width, Height, and Depth before continuing.';
                    return;
                }
            }

            this.dimensionError = null;
            this._runImageAnalysis();

        } else if (this.currentScreen === 2) {
            this._runRecommendation();

        } else if (this.currentScreen === 3) {
            this._pushToCpq();
        }
    }

    goBack() {
        // Cancel any in-flight Apex calls / animation steps so they don't
        // resolve and teleport the user forward after they've navigated back.
        this._cancelPendingWork();
        this.isLoading = false;

        if (this.currentScreen === 2) this.currentScreen = 1;
        else if (this.currentScreen === 3) this.currentScreen = 2;
    }

    // ── Phase 1: Image Analysis (only for Screen 2 prefill) ──────────────────
    async _runImageAnalysis() {
        this.isLoading    = true;
        this._cancelled   = false;
        this.loadingTitle = 'Analyzing Uploaded Files';
        this._setLoadingStepsPhase1();

        if (this.isDemoMode) {
            // Animation steps run sequentially; screen only advances after all complete
            await this._scheduleStep(1000);
            if (this._cancelled) return;
            this._advanceStep(2, 3);

            await this._scheduleStep(1000);
            if (this._cancelled) return;
            this._advanceStep(3, 4);

            await this._scheduleStep(1000);
            if (this._cancelled) return;
            this._advanceStep(4, null);

            this.aiAnalysis    = DEMO_ANALYSIS;
            this._prefillFromAI(DEMO_ANALYSIS);
            this.aiPrefilled   = true;
            this.isLoading     = false;
            this.currentScreen = 2;
            return;
        }

        // For live mode: run the animation steps and Apex call in parallel.
        // The screen only advances once BOTH the animation sequence AND Apex
        // have finished — whichever is slower sets the pace.
        const animationPromise = (async () => {
            await this._scheduleStep(1200);
            if (!this._cancelled) this._advanceStep(2, 3);
            await this._scheduleStep(1300); // cumulative: 2500ms
            if (!this._cancelled) this._advanceStep(3, 4);
        })();

        const ids = this.uploadedFiles.map(f => f.contentDocumentId);
        const [id1 = null, id2 = null, id3 = null] = ids;
        const measurementsJSON = JSON.stringify({
            width:  `${this.dimensions.width} meters`,
            height: `${this.dimensions.height} meters`,
            depth:  `${this.dimensions.depth} meters`,
        });

        console.log('Calling Apex runAnalysis with:', JSON.stringify({
            fileId1: id1,
            fileId2: id2,
            fileId3: id3,
            measurementsJSON
        }, null, 2));

        let apexResult;
        try {
            const apexPromise = runAnalysis({ fileId1: id1, fileId2: id2, fileId3: id3, measurementsJSON });

            // Wait for both animation and Apex — no skipped steps, no waiting forever
            const [, rawResult] = await Promise.all([animationPromise, apexPromise]);
            apexResult = rawResult;
        } catch (err) {
            if (this._cancelled) return;
            console.error('runAnalysis failed', err);
            this.isLoading     = false;
            this.aiPrefilled   = false;
            this.currentScreen = 2;
            this.dispatchEvent(new ShowToastEvent({
                title: 'AI Analysis failed',
                message: 'Could not analyse photos. Please configure manually.',
                variant: 'warning',
            }));
            return;
        }

        if (this._cancelled) return;

        let analysis;
        try {
            analysis = JSON.parse(apexResult);
            console.log('Raw Apex response:', apexResult);
            console.log('Parsed analysis:', JSON.stringify(analysis, null, 2));
            validateAnalysisShape(analysis);
        } catch (e) {
            console.error('Analysis response validation failed', e);
            this.isLoading     = false;
            this.aiPrefilled   = false;
            this.currentScreen = 2;
            this.dispatchEvent(new ShowToastEvent({
                title: 'AI Analysis failed',
                message: 'Unexpected response from analyser. Please configure manually.',
                variant: 'warning',
            }));
            return;
        }

        this._advanceStep(4, null);

        // Brief pause so the user sees step 4 complete before the screen changes
        await this._scheduleStep(400);
        if (this._cancelled) return;

        this.aiAnalysis    = analysis;
        this._prefillFromAI(analysis);
        this.aiPrefilled   = true;
        this.isLoading     = false;
        this.currentScreen = 2;
    }

    _setLoadingStepsPhase1() {
        this.loadingSteps = [
            { id: 1, label: 'Photos uploaded to Salesforce', statusClass: 'step-status done',    statusIcon: '✓' },
            { id: 2, label: 'Sending images to the LLM',     statusClass: 'step-status running', statusIcon: '●' },
            { id: 3, label: 'Extracting space constraints',  statusClass: 'step-status pending', statusIcon: '–' },
            { id: 4, label: 'Mapping to configuration',      statusClass: 'step-status pending', statusIcon: '–' },
        ];
    }

    _prefillFromAI(a) {
        if (a.recommendedLayout) {
            this.layoutOptions = this.layoutOptions.map(opt =>
                applySelected(opt, opt.id === a.recommendedLayout));
        }

        if (Array.isArray(a.containerTypes)) {
            const s = new Set(a.containerTypes);
            this.containerOptions = this.containerOptions.map(opt => applySelected(opt, s.has(opt.id)));
        }

        if (a.performanceTier) {
            this.performanceOptions = this.performanceOptions.map(opt =>
                applySelected(opt, opt.id === a.performanceTier));
        }

        if (Array.isArray(a.hardwareAddons)) {
            const s = new Set(a.hardwareAddons);
            this.hardwareOptions = this.hardwareOptions.map(opt => applySelected(opt, s.has(opt.id)));
        }

        if (Array.isArray(a.softwareAddons)) {
            const s = new Set(a.softwareAddons);
            this.softwareOptions = this.softwareOptions.map(opt => applySelected(opt, s.has(opt.id)));
        }

        if (Array.isArray(a.implementationServices)) {
            const s = new Set(a.implementationServices);
            this.implementationOptions = this.implementationOptions.map(opt => applySelected(opt, s.has(opt.id)));
        }

        if (Array.isArray(a.trainingServices)) {
            const s = new Set(a.trainingServices);
            this.trainingOptions = this.trainingOptions.map(opt => applySelected(opt, s.has(opt.id)));
        }

        if (Array.isArray(a.supportServices)) {
            const s = new Set(a.supportServices);
            this.supportOptions = this.supportOptions.map(opt => applySelected(opt, s.has(opt.id)));
        }
    }

    // ── Phase 2: Product Recommendation (fully owned by Apex) ─────────────────
    async _runRecommendation() {
        this.isLoading    = true;
        this._cancelled   = false;
        this.loadingTitle = 'Generating Recommendations';
        this._setLoadingStepsPhase2();

        if (this.isDemoMode) {
            await this._scheduleStep(900);
            if (this._cancelled) return;
            this._advanceStep(3, 4);

            await this._scheduleStep(900);
            if (this._cancelled) return;
            this._advanceStep(4, 5);

            await this._scheduleStep(800);
            if (this._cancelled) return;
            this._advanceStep(5, null);

            this._applyRecommendationResponse(DEMO_RECOMMENDATION);
            this.isLoading     = false;
            this.currentScreen = 3;
            return;
        }

        // Run animation steps and Apex in parallel; both must complete before advancing
        const animationPromise = (async () => {
            await this._scheduleStep(900);
            if (!this._cancelled) this._advanceStep(3, 4);
            await this._scheduleStep(900); // cumulative: 1800ms
            if (!this._cancelled) this._advanceStep(4, 5);
        })();

        const phase1AIAnalysisJSON                  = JSON.stringify(this.aiAnalysis || {});
        const availableProductCatalogJSON           = JSON.stringify(this.catalogData || []);
        const customerConfigurationSelectionsJSON   = JSON.stringify(this._buildCustomerConfigurationSelections());

        console.log('Calling Apex runRecommendation with:', JSON.stringify({
            Phase_1_AI_Analysis: phase1AIAnalysisJSON,
            Available_Product_Catalog: availableProductCatalogJSON,
            Customer_Configuration_Selections: customerConfigurationSelectionsJSON
        }, null, 2));

        let apexResult;
        try {
            const apexPromise = runRecommendation({
                Phase_1_AI_Analysis: phase1AIAnalysisJSON,
                Available_Product_Catalog: availableProductCatalogJSON,
                Customer_Configuration_Selections: customerConfigurationSelectionsJSON
            });

            const [, rawResult] = await Promise.all([animationPromise, apexPromise]);
            apexResult = rawResult;
        } catch (err) {
            if (this._cancelled) return;
            console.error('runRecommendation failed', err);
            this.isLoading = false;
            this.dispatchEvent(new ShowToastEvent({
                title: 'Recommendation failed',
                message: 'Could not generate product recommendation.',
                variant: 'error',
            }));
            return;
        }

        if (this._cancelled) return;

        let recommendationResponse;
        try {
            recommendationResponse = JSON.parse(apexResult);
            console.log('Raw recommender response:', apexResult);
            console.log('Parsed recommender response:', JSON.stringify(recommendationResponse, null, 2));
            validateRecommendationShape(recommendationResponse);
        } catch (e) {
            console.error('Recommendation response validation failed', e);
            this.isLoading = false;
            this.dispatchEvent(new ShowToastEvent({
                title: 'Recommendation failed',
                message: 'Unexpected response from recommender. Please try again.',
                variant: 'error',
            }));
            return;
        }

        this._advanceStep(5, null);
        this._applyRecommendationResponse(recommendationResponse);
        this.isLoading     = false;
        this.currentScreen = 3;
    }

    _setLoadingStepsPhase2() {
        this.loadingSteps = [
            { id: 1, label: 'Photos analysed',                  statusClass: 'step-status done',    statusIcon: '✓' },
            { id: 2, label: 'Configuration reviewed',           statusClass: 'step-status done',    statusIcon: '✓' },
            { id: 3, label: 'Preparing recommender inputs',     statusClass: 'step-status running', statusIcon: '●' },
            { id: 4, label: 'Generating bundle recommendation', statusClass: 'step-status pending', statusIcon: '–' },
            { id: 5, label: 'Building quote summary',           statusClass: 'step-status pending', statusIcon: '–' },
        ];
    }

    _advanceStep(doneId, runningId) {
        this.loadingSteps = this.loadingSteps.map(s => {
            if (s.id === doneId)    return { ...s, statusClass: 'step-status done',    statusIcon: '✓' };
            if (s.id === runningId) return { ...s, statusClass: 'step-status running', statusIcon: '●' };
            return s;
        });
    }

    _buildCustomerConfigurationSelections() {
        const selectedSingle = (options) => {
            const found = options.find(o => o.selected);
            return found ? found.id : null;
        };

        const selectedMulti = (options) => options.filter(o => o.selected).map(o => o.id);

        return {
            siteDetails: this.siteDetails,
            dimensions: this.dimensions,
            uploadedPhotoCount: this.uploadedFiles.length,
            selections: {
                layout: selectedSingle(this.layoutOptions),
                containerTypes: selectedMulti(this.containerOptions),
                performanceTier: selectedSingle(this.performanceOptions),
                hardwareAddons: selectedMulti(this.hardwareOptions),
                softwareAddons: selectedMulti(this.softwareOptions),
                implementationServices: selectedMulti(this.implementationOptions),
                trainingServices: selectedMulti(this.trainingOptions),
                supportServices: selectedMulti(this.supportOptions)
            }
        };
    }

    _applyRecommendationResponse(response) {
        const recProducts = Array.isArray(response?.recommendedProducts)
            ? response.recommendedProducts
            : [];

        const enrichedProducts = recProducts.map(rec => {
            const catalogProduct = this.catalogData.find(p => p.id === rec.id);

            if (!catalogProduct) {
                return {
                    id: rec.id,
                    name: rec.id,
                    sku: rec.id,
                    desc: rec.justification || 'Product returned by recommender but not found in catalog.',
                    category: 'service',
                    tag: 'service',
                    price: 0,
                    quantity: rec.quantity || 1,
                    justification: rec.justification || '',
                    priceFormatted: formatEur(0),
                    priceLabel: 'one-time',
                    tagLabel: TAG_LABELS.service,
                    tagClass: TAG_CLASSES.service
                };
            }

            const quantity = Number(rec.quantity) || 1;
            const unitPrice = Number(catalogProduct.price) || 0;
            const extendedPrice = unitPrice * quantity;

            return {
                ...catalogProduct,
                quantity,
                justification: rec.justification || '',
                desc: rec.justification || catalogProduct.desc,
                price: extendedPrice,
                unitPrice,
                priceFormatted: formatEur(extendedPrice),
                priceLabel: catalogProduct.category === 'software'
                    ? (quantity > 1 ? `per year · qty ${quantity}` : 'per year')
                    : (quantity > 1 ? `one-time · qty ${quantity}` : 'one-time'),
                tagLabel: TAG_LABELS[catalogProduct.tag] || 'Item',
                tagClass: TAG_CLASSES[catalogProduct.tag] || 'tag'
            };
        });

        this.recommendedProducts = enrichedProducts;

        const hw  = enrichedProducts
            .filter(p => p.category === 'hardware')
            .reduce((s, p) => s + (Number(p.price) || 0), 0);

        const sw  = enrichedProducts
            .filter(p => p.category === 'software')
            .reduce((s, p) => s + (Number(p.price) || 0), 0);

        const svc = enrichedProducts
            .filter(p => p.category === 'service')
            .reduce((s, p) => s + (Number(p.price) || 0), 0);

        this.quoteTotals = {
            hardware: formatEur(hw),
            software: formatEur(sw),
            services: formatEur(svc),
            grand: formatEur(hw + sw + svc),
        };

        this.recommendation = {
            title: response?.title || 'Recommended Bundle',
            subtitle: response?.subtitle || '',
            confidence: Number(response?.confidence) || 0,
            reasoning: response?.reasoning || '',
            warnings: Array.isArray(response?.warnings) ? response.warnings : [],
            suggestSiteSurvey: !!response?.suggestSiteSurvey
        };
    }

    // ── CPQ Push ──────────────────────────────────────────────────────────────
    async _pushToCpq() {
        this.isLoading    = true;
        this._cancelled   = false;
        this.quoteRef     = generateQuoteRef();
        this.loadingTitle = 'Creating Quote';
        this.loadingSteps = [
            { id: 1, label: 'Finalising product selection', statusClass: 'step-status done',    statusIcon: '✓' },
            { id: 2, label: 'Pushing to Revenue Cloud',     statusClass: 'step-status running', statusIcon: '●' },
            { id: 3, label: 'Generating quote document',    statusClass: 'step-status pending', statusIcon: '–' },
            { id: 4, label: 'Notifying account team',       statusClass: 'step-status pending', statusIcon: '–' },
        ];

        await this._scheduleStep(900);
        if (this._cancelled) return;
        this._advanceStep(2, 3);

        await this._scheduleStep(900);
        if (this._cancelled) return;
        this._advanceStep(3, 4);

        await this._scheduleStep(800);
        if (this._cancelled) return;
        this._advanceStep(4, null);

        this.isLoading     = false;
        this.currentScreen = 4;
    }
}