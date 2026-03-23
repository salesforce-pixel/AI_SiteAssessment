# AI-Powered Site Assessment

An intelligent Salesforce-based solution that uses AI to analyse site photos and recommend the right product configuration — guiding sales reps from site photo upload through to a configured quote in a single guided flow.

---

## What This Solution Does

The **AI-Powered Site Assessment** component is a multi-step Lightning Web Component (LWC) embedded on any Salesforce record page (typically an Opportunity). It walks a sales rep through a structured workflow:

1. **Site capture** — The rep uploads up to three photos of the customer's site alongside the space dimensions (width, height, depth in metres).
2. **AI-powered analysis** — Photos and measurements are sent to an Apex-backed LLM service that analyses the space and recommends a layout, container types, performance tier, and hardware/software/service add-ons.
3. **Configuration review** — The rep reviews and adjusts the AI-pre-filled configuration on a structured selection screen.
4. **Product recommendation** — A second AI call takes the finalised configuration and matches it against the product catalog (sourced from Custom Metadata) to produce a ranked bundle recommendation with pricing and justifications.
5. **Quote creation** — The confirmed recommendation is pushed to Revenue Cloud, a quote document is generated, and the account team is notified — all within the same flow.

A **demo mode** toggle allows reps to run through the full experience with fixture data, without uploading real photos or calling Apex — useful for internal demos and training.

---

## Prerequisites

Ensure the following are in place before deploying:

- **Salesforce CLI (sf CLI):** Latest version
- **Node.js:** Version 18 or higher
- **Git:** For version control
- A Salesforce org with the following features enabled:
  - Generative AI (via Einstein Setup)
  - Einstein for Sales
  - Prompt Builder
  - Data 360

---

## Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/salesforce-pixel/ai-site-assessment.git
cd ai-site-assessment
```

### Step 2: Authenticate with Your Salesforce Org

```bash
sf org login web -a targetOrg
```

> Replace `targetOrg` with your preferred alias for the org.

### Step 3: Deploy the Project

```bash
sf project deploy start -x manifest/package.xml -o targetOrg -l NoTestRun
```

This deploys all metadata — the LWC, Apex classes, Custom Metadata type, Custom Label, and any supporting flows.

### Step 4: Copy the Product Catalog (Custom Metadata) Record ID into the Custom Label

The component looks up the product catalog from a **Custom Metadata** record. The record ID must be stored in a Custom Label so the wire adapter can target it.

1. In Setup, go to **Custom Metadata Types** → **Product Catalog** → **Manage Records**.
2. Open the relevant record and copy its **Salesforce Record ID** from the URL. It looks like this - m0RHp000000YJ1Z.
3. Go to **Setup** → **Custom Labels** → find **`Product_Catalog_Metadata_Id`**.
4. Click **Edit** and paste the record ID as the label value. Save.

> ⚠️ This is a required manual step. Without it, the component will render an empty catalog warning and no recommendations can be generated.

### Step 5: Add the LWC to a Record Page

1. Navigate to the record page where you want to surface the component (e.g. an Opportunity record).
2. Click the **Setup** gear → **Edit Page** to open **Lightning App Builder**. Optioanlly, create a new Tab on the record page.
3. Locate **"Site Assessment"** in the component panel on the left.
4. Drag and drop it onto the page in your preferred location.
5. Click **Save** and then **Activate**.

> The component is self-contained and requires no additional page-level configuration beyond placement.

---

## Demo Mode

The component includes a built-in **demo mode** toggle on screen 1. When enabled:

- No photos need to be uploaded.
- All Apex calls are bypassed and replaced with realistic fixture data.
- The full three-screen flow runs with animated loading steps, a pre-filled configuration, and a sample product recommendation bundle.

This is safe to use in any org — it makes no writes to Salesforce data.

---

## Repository Structure

```
force-app/
└── main/
    └── default/
        ├── lwc/
        │   └── tomraSiteAssessment/           # Main LWC component
        ├── classes/
        │   ├── TomraSiteImageAnalyzer.cls     # Apex: photo analysis via LLM
        │   └── TomraSiteRecommender.cls       # Apex: product recommendation via LLM
        ├── customMetadata/
        │   └── Product_Catalog__mdt/      # Product catalog records
        └── labels/
            └── CustomLabels.labels-meta.xml  # Contains Product_Catalog_Metadata_Id
```

---

## Support

For questions or issues, contact [rshekhar@salesforce.com](mailto:rshekhar@salesforce.com).