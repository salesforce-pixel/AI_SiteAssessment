import { LightningElement, api, track, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import CATALOG_FIELD from '@salesforce/schema/Opportunity.Product_Catalog_JSON__c';
import runAnalysis from '@salesforce/apex/TomraSiteImageAnalyzer.runAnalysis';

// ── Demo fixture — simulates a full LLM response ──────────────────────────────
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

const TAG_LABELS  = { required: 'Core', addon: 'Add-on', service: 'Service', software: 'Software' };
const TAG_CLASSES = { required: 'tag tag-required', addon: 'tag tag-addon', service: 'tag tag-service', software: 'tag tag-software' };

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

function formatEur(amount) {
    return '€' + amount.toLocaleString('en-DE');
}

function generateQuoteRef() {
    return 'QUO-' + Math.floor(10000 + Math.random() * 90000);
}

export default class TomraSiteAssessment extends LightningElement {

    @api recordId;
    @track isDemoMode = false;

    // ── Demo pill getters ─────────────────────────────────────────────────────
    get demoPillClass()      { return 'demo-pill' + (this.isDemoMode ? ' demo-pill-on' : ''); }
    get demoPillTrackClass() { return 'demo-pill-track' + (this.isDemoMode ? ' demo-pill-track-on' : ''); }
    get demoPillThumbClass() { return 'demo-pill-thumb' + (this.isDemoMode ? ' demo-pill-thumb-on' : ''); }

    // ── Catalog ──────────────────────────────────────────────────────────────
    @track catalogData = [];

    @wire(getRecord, { recordId: '$recordId', fields: [CATALOG_FIELD] })
    wiredRecord({ data, error }) {
        if (data) {
            const json = getFieldValue(data, CATALOG_FIELD);
            if (json) {
                try { this.catalogData = JSON.parse(json); }
                catch (e) { console.error('[TOMRA] Invalid JSON in Product_Catalog_JSON__c', e); this.catalogData = []; }
            } else { this.catalogData = []; }
        }
        if (error) { console.error('[TOMRA] Could not read Opportunity record', error); this.catalogData = []; }
    }

    get catalogReady()    { return this.catalogData.length > 0; }
    get catalogNotReady() { return !this.catalogReady; }
    get catalogEmptyMessage() {
        return this.recordId
            ? 'No product catalog found on this Opportunity. Populate Product_Catalog_JSON__c to continue.'
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
            const previewUrl = '/sfc/servlet.shepherd/document/download/' + f.documentId;
            this.uploadedFiles = [...this.uploadedFiles, { 
                contentDocumentId: f.documentId, 
                name: f.name,
                previewUrl 
            }];
        });
        console.log('All uploaded files so far:', JSON.stringify(this.uploadedFiles, null, 2));
        this.photoError = null;
    }

    handleDemoToggle() {
        this.isDemoMode = !this.isDemoMode;
    }

    // ── State ─────────────────────────────────────────────────────────────────
    @track currentScreen  = 1;
    @track isLoading      = false;
    @track loadingTitle   = 'Analysing site & generating recommendation';
    @track assessmentRef  = 'ASS-' + Math.floor(1000 + Math.random() * 9000);
    @track quoteRef       = generateQuoteRef();
    @track aiPrefilled    = false;
    @track aiAnalysis     = null;

    @track dimensions  = { width: '', height: '', depth: '' };
    @track dimensionError = null;
    @track siteDetails = { storeName: 'REMA 1000 Grønland', city: 'Oslo', notes: '' };

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

    get headerSubtitle() {
        if (this.isLoading) return this.loadingTitle + '…';
        const map = { 1: 'Site Photos & Dimensions', 2: 'System Configuration', 3: 'Product Recommendation', 4: 'Quote Confirmed' };
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
        if (this.currentScreen === 4) return 'step-dot completed'; // all done on screen 4
        return 'step-dot inactive';
    }
    _labelClass(n) { return 'step-label' + (n === this.currentScreen ? ' active' : ''); }

    // ── Handlers ──────────────────────────────────────────────────────────────
    handleDimensionChange(event) {
        const field = event.target.dataset.field;
        this.dimensions = { ...this.dimensions, [field]: parseFloat(event.target.value) || 0 };
    }
    handleSiteDetailChange(event) {
        const field = event.target.dataset.field;
        this.siteDetails = { ...this.siteDetails, [field]: event.target.value };
    }
    handleSingleSelect(event) {
        const prop = this._groupProp(event.currentTarget.dataset.group);
        const id   = event.currentTarget.dataset.id;
        this[prop] = this[prop].map(opt => applySelected(opt, opt.id === id));
    }
    handleMultiSelect(event) {
        const prop = this._groupProp(event.currentTarget.dataset.group);
        const id   = event.currentTarget.dataset.id;
        this[prop] = this[prop].map(opt => opt.id !== id ? opt : applySelected(opt, !opt.selected));
    }
    _groupProp(group) {
        const map = {
            layout: 'layoutOptions', containers: 'containerOptions', performance: 'performanceOptions',
            hardware: 'hardwareOptions', software: 'softwareOptions',
            implementation: 'implementationOptions', training: 'trainingOptions', support: 'supportOptions',
        };
        return map[group];
    }

    // ── Restart ───────────────────────────────────────────────────────────────
    handleRestart() {
        this.currentScreen  = 1;
        this.isLoading      = false;
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

        const resetOptions = opts => opts.map(o => applySelected(o, false));
        this.layoutOptions         = resetOptions(this.layoutOptions);
        this.containerOptions      = resetOptions(this.containerOptions);
        this.performanceOptions    = resetOptions(this.performanceOptions);
        this.hardwareOptions       = resetOptions(this.hardwareOptions);
        this.softwareOptions       = resetOptions(this.softwareOptions);
        this.implementationOptions = resetOptions(this.implementationOptions);
        this.trainingOptions       = resetOptions(this.trainingOptions);
        this.supportOptions        = resetOptions(this.supportOptions);
        this.dimensionError = null;
    }

    // ── Navigation ────────────────────────────────────────────────────────────
    goNext() {
        if (this.currentScreen === 1) {
            if (this.nextDisabled) return;
            // Validate dimensions (live mode only)
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
        if (this.currentScreen === 2) this.currentScreen = 1;
        else if (this.currentScreen === 3) this.currentScreen = 2;
    }

    // ── Phase 1: Image Analysis ───────────────────────────────────────────────
    _runImageAnalysis() {
        this.isLoading    = true;
        this.loadingTitle = 'Analysing site photos with Agentforce';
        this._setLoadingStepsPhase1();

        if (this.isDemoMode) {
            setTimeout(() => { this._advanceStep(2, 3); }, 1000);
            setTimeout(() => { this._advanceStep(3, 4); }, 2000);
            setTimeout(() => {
                this._advanceStep(4, null);
                this.aiAnalysis    = DEMO_ANALYSIS;
                this._prefillFromAI(DEMO_ANALYSIS);
                this.aiPrefilled   = true;
                this.isLoading     = false;
                this.currentScreen = 2;
            }, 3000);
            return;
        }

        // Live mode — cosmetic step advances, independent of Apex timing
        setTimeout(() => { this._advanceStep(2, 3); }, 1200);
        setTimeout(() => { this._advanceStep(3, 4); }, 2500);

        const ids = this.uploadedFiles.map(f => f.contentDocumentId);
        const [id1 = null, id2 = null, id3 = null] = ids;
        const measurementsJSON = JSON.stringify(this.dimensions);

        console.log('Calling Apex runAnalysis with:', JSON.stringify({ fileId1: id1, fileId2: id2, fileId3: id3, measurementsJSON }, null, 2));
        runAnalysis({ fileId1: id1, fileId2: id2, fileId3: id3, measurementsJSON })
            .then(result => {
                let analysis;
                try {
                    analysis = JSON.parse(result);
                    console.log('Raw Apex response:', result);
                    console.log('Parsed analysis:', JSON.stringify(analysis, null, 2));
                } catch (e) { throw new Error('Invalid JSON from TomraSiteImageAnalyzer: ' + result); }

                // Mark final step done, brief pause so user sees all four ✓ before transition
                this._advanceStep(4, null);
                setTimeout(() => {
                    this.aiAnalysis    = analysis;
                    this._prefillFromAI(analysis);
                    this.aiPrefilled   = true;
                    this.isLoading     = false;
                    this.currentScreen = 2;
                }, 400);
            })
            .catch(err => {
                console.error('runAnalysis failed', err);
                this.isLoading     = false;
                this.aiPrefilled   = false;
                this.currentScreen = 2;
                this.dispatchEvent(new ShowToastEvent({
                    title:   'AI Analysis failed',
                    message: 'Could not analyse photos. Please configure manually.',
                    variant: 'warning',
                }));
            });
    }

    _setLoadingStepsPhase1() {
        this.loadingSteps = [
            { id: 1, label: 'Photos uploaded to Salesforce', statusClass: 'step-status done',    statusIcon: '✓' },
            { id: 2, label: 'Sending images to the LLM',   statusClass: 'step-status running', statusIcon: '●' },
            { id: 3, label: 'Extracting space constraints',        statusClass: 'step-status pending', statusIcon: '–' },
            { id: 4, label: 'Mapping to TOMRA product catalog',    statusClass: 'step-status pending', statusIcon: '–' },
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

    // ── Phase 2: Product Recommendation ──────────────────────────────────────
    _runRecommendation() {
        this.isLoading    = true;
        this.loadingTitle = 'Analysing site & generating recommendation';
        this._setLoadingStepsPhase2();

        setTimeout(() => { this._advanceStep(3, 4); }, 900);
        setTimeout(() => { this._advanceStep(4, 5); }, 1800);
        setTimeout(() => {
            this._advanceStep(5, null);
            this._buildRecommendation();
            this.isLoading     = false;
            this.currentScreen = 3;
        }, 2600);
    }

    _setLoadingStepsPhase2() {
        this.loadingSteps = [
            { id: 1, label: 'Photos analysed',                  statusClass: 'step-status done',    statusIcon: '✓' },
            { id: 2, label: 'Configuration reviewed',           statusClass: 'step-status done',    statusIcon: '✓' },
            { id: 3, label: 'Querying product catalog',         statusClass: 'step-status running', statusIcon: '●' },
            { id: 4, label: 'Generating bundle recommendation', statusClass: 'step-status pending', statusIcon: '–' },
            { id: 5, label: 'Building Quote',               statusClass: 'step-status pending', statusIcon: '–' },
        ];
    }

    _advanceStep(doneId, runningId) {
        this.loadingSteps = this.loadingSteps.map(s => {
            if (s.id === doneId)    return { ...s, statusClass: 'step-status done',    statusIcon: '✓' };
            if (s.id === runningId) return { ...s, statusClass: 'step-status running', statusIcon: '●' };
            return s;
        });
    }

    _buildRecommendation() {
        const allGroups = [
            'layoutOptions','containerOptions','performanceOptions',
            'hardwareOptions','softwareOptions','implementationOptions',
            'trainingOptions','supportOptions',
        ];
        const allSelected = new Set();
        allGroups.forEach(g => this[g].filter(o => o.selected).forEach(o => allSelected.add(o.id)));

        const isLongTunnel = allSelected.has('Long Tunnel');
        const coreId       = isLongTunnel ? 'R1-LONG' : 'R1-MED';
        const coreProduct  = this.catalogData.find(p => p.id === coreId);

        const addons = this.catalogData.filter(p =>
            p.id !== 'R1-MED' && p.id !== 'R1-LONG' &&
            p.triggered.some(t => allSelected.has(t))
        );

        const matched = [coreProduct, ...addons].filter(Boolean).map(p => ({
            ...p,
            priceFormatted: formatEur(p.price),
            priceLabel:     p.category === 'software' ? 'per year' : 'one-time',
            tagLabel:       TAG_LABELS[p.tag],
            tagClass:       TAG_CLASSES[p.tag],
        }));

        this.recommendedProducts = matched;

        const hw  = matched.filter(p => p.category === 'hardware').reduce((s, p) => s + p.price, 0);
        const sw  = matched.filter(p => p.category === 'software').reduce((s, p) => s + p.price, 0);
        const svc = matched.filter(p => p.category === 'service').reduce((s, p)  => s + p.price, 0);
        this.quoteTotals = {
            hardware: formatEur(hw), software: formatEur(sw),
            services: formatEur(svc), grand: formatEur(hw + sw + svc),
        };

        const ai     = this.aiAnalysis;
        const w      = this.dimensions.width  || 1.8;
        const h      = this.dimensions.height || 2.4;
        const d      = this.dimensions.depth  || 2.1;
        const city   = this.siteDetails.city  || 'Oslo';
        const pCount = this.uploadedFiles.length;

        const title    = isLongTunnel ? 'TOMRA R1 Long Tunnel' : 'TOMRA R1 Medium Tunnel';
        const subtitle = (pCount > 0 ? `${pCount} photo${pCount > 1 ? 's' : ''} · ` : '') +
                         `${w.toFixed(1)}×${h.toFixed(1)}×${d.toFixed(1)}m · ${city}`;

        const reasoning         = ai?.reasoning         || `Space dimensions support a ${isLongTunnel ? 'Long' : 'Medium'} Tunnel configuration.`;
        const confidence        = ai?.confidence        ?? 92;
        const warnings          = ai?.warnings          || [];
        const suggestSiteSurvey = ai?.suggestSiteSurvey ?? false;

        this.recommendation = { title, subtitle, confidence, reasoning, warnings, suggestSiteSurvey };
    }

    // ── CPQ Push ──────────────────────────────────────────────────────────────
    _pushToCpq() {
        this.isLoading    = true;
        this.loadingTitle = 'Creating quote in Revenue Cloud';
        this.quoteRef     = generateQuoteRef();
        this.loadingSteps = [
            { id: 1, label: 'Finalising product selection',     statusClass: 'step-status done',    statusIcon: '✓' },
            { id: 2, label: 'Pushing to Revenue Cloud',         statusClass: 'step-status running', statusIcon: '●' },
            { id: 3, label: 'Generating quote document',        statusClass: 'step-status pending', statusIcon: '–' },
            { id: 4, label: 'Notifying account team',           statusClass: 'step-status pending', statusIcon: '–' },
        ];

        setTimeout(() => { this._advanceStep(2, 3); }, 900);
        setTimeout(() => { this._advanceStep(3, 4); }, 1800);
        setTimeout(() => {
            this._advanceStep(4, null);
            this.isLoading     = false;
            this.currentScreen = 4;
        }, 2600);
    }
}