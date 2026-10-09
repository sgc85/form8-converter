# JCQ Form 8 Converter (prototype)

Browser-only batch converter for **the exact 2025 JCQ Form 8 PDF master** supplied for this project. The original and destination PDFs share the same 124 widgets / 102 fields, so the application copies existing form values into the approved master without rewriting its static pages.

No AI, backend, remote analytics, external PDF upload or Word conversion is involved.

## Website

**https://sgc85.github.io/form8-converter/**

You may first need to enable **GitHub → form8-converter → Settings → Pages → Build and deployment → Source: GitHub Actions**. The workflow tests, builds and deploys the static site automatically.

## How to use

1. Select the **original Form 8 Master.pdf** supplied for this project. The site checks its SHA-256 checksum and deliberately rejects edited or resaved versions. The master remains on the local computer.
2. Select one or many completed **original fillable Form 8 PDFs**, or drop them into the browser.
3. Convert a single PDF or click **Convert all pending** for the batch.
4. Use **Preview** and **Download PDF** on each result, or **Download completed ZIP** for all converted PDFs and a text conversion report.
5. Inspect all 12 pages of every result in **Adobe Acrobat**. Check long text boxes, scores, the candidate name on every page, Part 3 declarations and signatures. Re-sign if required.

The output PDFs retain their input filenames (including leading zeroes).

## Why the PDF master isn't checked into this public repository

The authoritative master supplied for the experiment has **prefilled sample staff information, names and signatures**. Rather than publishing those in a public GitHub repository, the application asks staff to select the master locally each session. The SHA-256 fingerprint of that exact file is fixed in the source code.

The converter creates each output from that exact original master file, clears all of its existing editable entries, and populates the corresponding fields from the selected source. It **does not redraw or approximate** the JCQ layout. The resulting file is not *byte-for-byte* identical because populated fields and their appearance streams change, but the original master provides every static page and form position.

## Validation and safety

- Master must match a pinned SHA-256 fingerprint.
- Both source and destination must have 12 pages, 102 distinct field names, 124 widgets, matching types/coordinates, and matching page sizes.
- Missing or mismatched fields **block conversion**; they are not guessed.
- All prefilled master fields are cleared first, including the sample Part 3 declaration.
- After writing, output values are read back and compared against the source fields.
- The original editable form fields remain editable in the generated PDF.
- Potentially excessive narrative lengths and missing Part 3 information produce warnings.
- **Digital PDF signatures cannot be transferred**: editing PDF bytes invalidates them. Typed signature text, where present in source fields, is copied as text but must be verified; a new signature may be needed.
- The site has no server code or PDF upload paths, and no external runtime CDN. Its Content Security Policy sets connect-src to none.
- Inputs and outputs are held in browser-tab memory. There is no localStorage or IndexedDB persistence.
- Never commit source, filled or processed PDFs, or pupil mapping files, into this repository.

## Limits / production-readiness

**This is a prototype, not an audited or approved SEND solution.** A matching field map and successful save/reload do **not** prove that all text will print or display correctly in every PDF viewer. Long text and embedded fonts can create problems. Use Adobe Acrobat for comparison/printing and perform representative acceptance testing with fictional data before any real records.

The program does **not** review suitability or legality of exam access arrangements, write evidence, correct forms, or reassess a candidate. It only copies existing data. The SEND team remains responsible for authorising and signing the correct JCQ documentation.

Encrypted, scanned, flattened, or different versions of the source form are rejected. IT/DPO approval is still advisable before using live identifiable SEND records, even though the application is local-only.

## Test and develop

Requires Node.js 22:

    npm install
    npm test
    npm run dev

The GitHub Actions workflow runs the unit tests, builds the website and deploys it. Runtime JS is bundled with Vite; no PDF files are committed. Fixed top-level dependency versions: pdf-lib 1.17.1; JSZip 3.10.1; Vite 6.3.5.

## Acceptance test checklist

Use several fictional or already-safe completed PDFs covering: candidate headers, multi-line classroom evidence, reader/rest-break checkboxes, reading and writing scores, cognitive-processing tables, assessor details and the Part 3 declaration. Compare the converted PDFs against the originals and blank master **page by page in Acrobat**, checking printed output as well as editable field values. Pay extra attention to cryptographic signatures and very long text fields.

**JCQ:** The form is not distributed here. The school must use the correct authorised version for its cohort and follow JCQ requirements.
