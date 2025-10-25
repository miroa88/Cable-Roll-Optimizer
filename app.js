/* Cable Roll Optimizer main script */
(function () {
  'use strict';

  const floorPalette = [
    'FFFDE68A',
    'FFBAE6FD',
    'FFD9F99D',
    'FFC7D2FE',
    'FFBBF7D0',
    'FFA5F3FC',
    'FFFBCFE8',
    'FFE0F2FE',
    'FFFECACA',
    'FFE9D5FF',
    'FFE2F0CB',
    'FFD1FAE5',
  ];

  const numberFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  const state = {
    rows: [],
    leftovers: [],
    assignments: [],
    metrics: null,
    meta: {
      toleranceUses: 0,
      cableSizes: [],
      floors: [],
      algorithmUsed: null,
    },
  };

  const fileInput = document.getElementById('file-input');
  const rollLengthInput = document.getElementById('roll-length');
  const toleranceInput = document.getElementById('tolerance');
  const toleranceLimitInput = document.getElementById('tolerance-limit');
  const wasteThresholdInput = document.getElementById('waste-threshold');
  const optimizationModeControl = document.getElementById('optimization-mode');
  const previewTableBody = document.querySelector('#preview-table tbody');
  const optimizeButton = document.getElementById('optimize-btn');
  const exportButton = document.getElementById('export-btn');
  const printResultsButton = document.getElementById('print-results-btn');
  const statusEl = document.getElementById('status');
  const summaryEl = document.getElementById('summary');
  const resultsTableBody = document.querySelector('#results-table tbody');
  const downloadTemplateButton = document.getElementById('download-template-btn');
  const fileDropZone = document.getElementById('file-drop-zone');
  const fileBrowseButton = document.getElementById('file-browse-btn');
  const fileNameDisplay = document.getElementById('file-name-display');
  const leftoverForm = document.getElementById('leftover-form');
  const leftoverTableBody = document.querySelector('#leftover-table tbody');
  const fileInfoPanel = document.getElementById('file-info');
  const infoCableSizes = document.getElementById('info-cable-sizes');
  const infoFloors = document.getElementById('info-floors');
  const infoTotalUnits = document.getElementById('info-total-units');
  let selectedOptimizationMode = 'balanced';

  if (optimizationModeControl) {
    const modeButtons = Array.from(optimizationModeControl.querySelectorAll('.mode-toggle__option'));
    if (modeButtons.length) {
      const activateButton = (button) => {
        if (!button) return;
        const mode = button.dataset.mode;
        if (!mode) return;
        selectedOptimizationMode = mode;
        modeButtons.forEach((btn) => {
          const isActive = btn === button;
          btn.classList.toggle('is-active', isActive);
          btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
          btn.setAttribute('tabindex', isActive ? '0' : '-1');
        });
      };

      const initialButton =
        modeButtons.find((btn) => btn.classList.contains('is-active')) || modeButtons[0];
      activateButton(initialButton);

      optimizationModeControl.addEventListener('click', (event) => {
        const option = event.target.closest('.mode-toggle__option');
        if (!option || !optimizationModeControl.contains(option)) return;
        activateButton(option);
      });

      optimizationModeControl.addEventListener('keydown', (event) => {
        if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
          return;
        }
        event.preventDefault();
        const currentIndex = modeButtons.findIndex(
          (btn) => btn.getAttribute('aria-checked') === 'true'
        );
        if (currentIndex === -1) return;

        let nextIndex = currentIndex;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          nextIndex = (currentIndex + 1) % modeButtons.length;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          nextIndex = (currentIndex - 1 + modeButtons.length) % modeButtons.length;
        }

        const nextButton = modeButtons[nextIndex];
        activateButton(nextButton);
        nextButton.focus();
      });
    }
  }

  if (downloadTemplateButton) {
    downloadTemplateButton.addEventListener('click', () => {
      const link = document.createElement('a');
      link.href = 'template.xlsx';
      link.download = 'cable-schedule-template.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

  function formatNumber(value) {
    return numberFormatter.format(Math.round(value * 100) / 100);
  }

  function getWasteThreshold() {
    const fallback = 30;
    if (!wasteThresholdInput) return fallback;
    const value = parseFloat(wasteThresholdInput.value);
    if (!Number.isFinite(value) || value <= 0) {
      wasteThresholdInput.value = fallback;
      return fallback;
    }
    return value;
  }

  function updateFileNameDisplay(name) {
    if (!fileNameDisplay) return;
    if (name) {
      fileNameDisplay.textContent = `Selected: ${name}`;
    } else {
      fileNameDisplay.textContent = 'No file selected yet.';
    }
  }

  function setStatus(message, type = null) {
    statusEl.textContent = message;
    statusEl.classList.remove('status--error', 'status--warning');
    if (type) {
      statusEl.classList.add(`status--${type}`);
    }
  }

  function resetResults() {
    state.assignments = [];
    state.metrics = null;
    // Don't reset cableSizes and floors - keep file metadata
    state.meta.toleranceUses = 0;
    state.meta.algorithmUsed = null;
    summaryEl.innerHTML = '';
    resultsTableBody.innerHTML = '';
    exportButton.disabled = true;
    printResultsButton.disabled = true;
  }

  function toFloor(unit) {
    // Handle various unit number formats:
    // - 101, 102, 201, 202 (standard: first digit(s) = floor)
    // - 1-01, 2-05 (floor-unit with dash)
    // - A101, B205 (letter prefix)
    // - 1A, 2B (floor with letter suffix)
    // - PH1, PH2 (penthouse)
    // - G01, L01 (ground/lobby/basement)

    const unitStr = String(unit).trim().toUpperCase();

    // Check for special cases
    if (unitStr.startsWith('PH')) return 'PH';
    if (unitStr.startsWith('P')) return 'PH';
    if (unitStr.startsWith('G') || unitStr.startsWith('GF')) return 'G';
    if (unitStr.startsWith('L') || unitStr.startsWith('LOBBY')) return 'L';
    if (unitStr.startsWith('B') || unitStr.startsWith('BSMT') || unitStr.startsWith('BASE')) return 'B';

    // Extract first number sequence
    const match = unitStr.match(/\d+/);
    if (!match) return unitStr; // Return as-is if no numbers

    const num = parseInt(match[0], 10);
    if (Number.isNaN(num)) return unitStr;

    // Single or double digit units (like 1-20) = ground floor or single floor building
    if (num < 100) {
      return String(num);
    }

    // Standard format: 101-199 = floor 1, 201-299 = floor 2, etc.
    if (num >= 100) {
      return Math.floor(num / 100).toString();
    }

    return unitStr;
  }

  function isValidSpreadsheet(file) {
    if (!file) return false;
    const name = file.name ?? '';
    if (/\.(xlsx|xlsm)$/i.test(name)) return true;
    if (file.type && file.type.includes('sheet')) return true;
    return false;
  }

  function renderPreview() {
    if (!state.rows.length) {
      previewTableBody.innerHTML = '<tr><td colspan="4">Upload an Excel file to see a preview.</td></tr>';
      return;
    }

    previewTableBody.innerHTML = state.rows
      .map(
        (row) => `<tr>
          <td>${row.unit}</td>
          <td>${row.floor}</td>
          <td>${row.cableSize}</td>
          <td>${formatNumber(row.length)}</td>
        </tr>`
      )
      .join('');
  }

  async function loadWorkbookFile(file) {
    if (!file) return;
    if (!isValidSpreadsheet(file)) {
      setStatus('Upload an Excel workbook (.xlsx or .xlsm).', 'warning');
      updateFileNameDisplay(null);
      return;
    }

    updateFileNameDisplay(file.name);
    setStatus('Reading workbook...');
    try {
      const data = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(data);
      const sheet = workbook.worksheets[0];
      if (!sheet) {
        throw new Error('No worksheet detected in the file.');
      }

      // Get actual column count (only columns with data)
      const actualColumnCount = sheet.actualColumnCount || sheet.columnCount;

      // Check if total columns is divisible by 3 for multi-floor layout
      const isMultiFloor = actualColumnCount % 3 === 0 && actualColumnCount >= 3;
      const totalFloors = isMultiFloor ? Math.floor(actualColumnCount / 3) : 1;

      const headerRow = sheet.getRow(1);
      const headers = {};
      headerRow.eachCell((cell, colNumber) => {
        const headerText = cell.text.toString().trim().toLowerCase();
        if (!headers[headerText]) {
          headers[headerText] = [];
        }
        headers[headerText].push(colNumber);
      });

      const rows = [];
      const cableSizesFound = new Set();
      const floorsFound = new Set();

      // Multi-floor layout: total columns ÷ 3 = number of floors
      if (isMultiFloor && totalFloors > 1) {
        setStatus(`Detecting multi-floor layout: ${actualColumnCount} columns = ${totalFloors} floors...`);

        // Process each group of 3 columns as a floor
        for (let floorIndex = 0; floorIndex < totalFloors; floorIndex++) {
          const unitsCol = (floorIndex * 3) + 1;
          const sizeCol = (floorIndex * 3) + 2;
          const lengthCol = (floorIndex * 3) + 3;

          // Verify headers match expected pattern (flexible matching)
          const header1 = sheet.getCell(1, unitsCol).text.toString().trim().toLowerCase();
          const header2 = sheet.getCell(1, sizeCol).text.toString().trim().toLowerCase();
          const header3 = sheet.getCell(1, lengthCol).text.toString().trim().toLowerCase();

          console.log(`Floor ${floorIndex + 1}: Headers = "${header1}" | "${header2}" | "${header3}"`);

          const isUnits = header1.includes('unit') || header1.includes('apt') || header1.includes('suite');
          const isCableSize = header2.includes('cable') || header2.includes('size') || header2.includes('wire');
          const isLength = header3.includes('length') || header3.includes('ft') || header3.includes('feet') || header3.includes('distance');

          // Relaxed validation: If at least 2 out of 3 headers match, proceed
          const matchCount = (isUnits ? 1 : 0) + (isCableSize ? 1 : 0) + (isLength ? 1 : 0);

          if (matchCount < 2) {
            console.warn(`Floor ${floorIndex + 1} (cols ${unitsCol}-${lengthCol}) doesn't match expected pattern (only ${matchCount}/3 matched). Skipping.`);
            continue;
          }

          console.log(`Floor ${floorIndex + 1}: Pattern matched (${matchCount}/3), reading data...`);

          // Extract data from this floor group
          sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header

            const unitCell = row.getCell(unitsCol);
            const sizeCell = row.getCell(sizeCol);
            const lengthCell = row.getCell(lengthCol);

            const unitVal = unitCell?.text?.toString().trim();
            const sizeVal = sizeCell?.text?.toString().trim();
            const rawLength = lengthCell?.value ?? lengthCell?.text ?? '';
            const lengthVal = parseFloat(rawLength);

            if (!unitVal || !sizeVal || Number.isNaN(lengthVal) || lengthVal <= 0) {
              return;
            }

            const floorNum = toFloor(unitVal);

            // Debug: Log first cable size found
            if (cableSizesFound.size === 0) {
              console.log(`First cable size found: "${sizeVal}"`);
            }

            cableSizesFound.add(sizeVal);
            floorsFound.add(floorNum);

            rows.push({
              unit: unitVal,
              cableSize: sizeVal,
              length: lengthVal,
              floor: floorNum,
              columnGroup: floorIndex + 1,
            });
          });
        }
      } else {
        // Single column layout (original format)
        setStatus('Detecting single-column layout...');

        const unitsColumns = headers.units ?? headers['unit'] ?? headers.apt ?? headers.suite ?? [];
        const sizeColumns = headers['cable size'] ?? headers['cable'] ?? headers['wire size'] ?? [];
        const lengthColumns = headers['length(ft)'] ?? headers['length (ft)'] ?? headers['length'] ?? headers['ft'] ?? [];

        const unitsCol = unitsColumns[0] ?? null;
        const sizeCol = sizeColumns[0] ?? null;
        const lengthCol = lengthColumns[0] ?? null;

        if (!unitsCol || !sizeCol || !lengthCol) {
          throw new Error('Missing required columns. Please ensure Units, Cable size, Length(FT) exist.');
        }

        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          if (rowNumber === 1) return;
          const unitCell = row.getCell(unitsCol);
          const sizeCell = row.getCell(sizeCol);
          const lengthCell = row.getCell(lengthCol);

          const unitVal = unitCell?.text?.toString().trim();
          const sizeVal = sizeCell?.text?.toString().trim();
          const rawLength = lengthCell?.value ?? lengthCell?.text ?? '';
          const lengthVal = parseFloat(rawLength);

          if (!unitVal || !sizeVal || Number.isNaN(lengthVal)) {
            return;
          }

          const floorNum = toFloor(unitVal);
          cableSizesFound.add(sizeVal);
          floorsFound.add(floorNum);

          rows.push({
            unit: unitVal,
            cableSize: sizeVal,
            length: lengthVal,
            floor: floorNum,
          });
        });
      }

      if (!rows.length) {
        throw new Error('No valid rows found in the spreadsheet.');
      }

      // Sort floors for display (handle skipped floors)
      const sortedFloors = Array.from(floorsFound).sort((a, b) => {
        const numA = parseInt(a);
        const numB = parseInt(b);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a).localeCompare(String(b));
      });

      const cableSizesArray = Array.from(cableSizesFound).sort();
      console.log(`Cable sizes collected:`, cableSizesArray);
      console.log(`Floors collected:`, Array.from(floorsFound));
      console.log(`Total rows:`, rows.length);

      state.rows = rows;
      state.meta.cableSizes = cableSizesArray;
      state.meta.floors = sortedFloors;

      console.log(`state.meta.cableSizes after assignment:`, state.meta.cableSizes);

      renderPreview();
      optimizeButton.disabled = false;
      resetResults();

      const cableSummary = state.meta.cableSizes && state.meta.cableSizes.length > 0
        ? state.meta.cableSizes.join(', ')
        : 'None detected';
      const floorSummary = sortedFloors && sortedFloors.length > 0
        ? (sortedFloors.length <= 10 ? sortedFloors.join(', ') : `${sortedFloors.slice(0, 10).join(', ')}...`)
        : 'None detected';

      // Update info panel
      if (fileInfoPanel) {
        fileInfoPanel.style.display = 'block';
        if (infoCableSizes) infoCableSizes.textContent = cableSummary;
        if (infoFloors) infoFloors.textContent = floorSummary;
        if (infoTotalUnits) infoTotalUnits.textContent = rows.length;
      }

      setStatus(
        `Loaded ${rows.length} units from "${sheet.name}". ` +
        `Cable sizes: ${cableSummary}. ` +
        `Floors: ${floorSummary}.`
      );
    } catch (error) {
      console.error(error);
      setStatus(`Error: ${error.message}`, 'error');
      state.rows = [];
      state.meta.cableSizes = [];
      state.meta.floors = [];
      previewTableBody.innerHTML = '';
      optimizeButton.disabled = true;
      resetResults();
      if (fileInfoPanel) fileInfoPanel.style.display = 'none';
    }
  }

  async function handleFileLoad(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadWorkbookFile(file);
    event.target.value = '';
  }

  function initializeFileInputUI() {
    if (fileBrowseButton && fileInput) {
      fileBrowseButton.addEventListener('click', (event) => {
        event.preventDefault();
        fileInput.click();
      });
    }

    if (!fileDropZone) return;

    let dragDepth = 0;

    const preventDragDefaults = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    fileDropZone.addEventListener('dragenter', (event) => {
      preventDragDefaults(event);
      dragDepth += 1;
      fileDropZone.classList.add('is-dragover');
    });

    fileDropZone.addEventListener('dragover', (event) => {
      preventDragDefaults(event);
    });

    fileDropZone.addEventListener('dragleave', (event) => {
      preventDragDefaults(event);
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        fileDropZone.classList.remove('is-dragover');
      }
    });

    fileDropZone.addEventListener('drop', async (event) => {
      preventDragDefaults(event);
      dragDepth = 0;
      fileDropZone.classList.remove('is-dragover');

      const files = event.dataTransfer?.files;
      if (!files || !files.length) return;
      const file = files[0];

      if (!isValidSpreadsheet(file)) {
        setStatus('Upload an Excel workbook (.xlsx or .xlsm).', 'warning');
        updateFileNameDisplay(null);
        return;
      }

      if (fileInput && typeof DataTransfer !== 'undefined') {
        try {
          const transfer = new DataTransfer();
          transfer.items.add(file);
          fileInput.files = transfer.files;
        } catch (error) {
          console.warn('Unable to sync file input from drop event:', error);
        }
      }

      await loadWorkbookFile(file);
    });

    fileDropZone.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      fileInput?.click();
    });

    fileDropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput?.click();
      }
    });
  }

  function renderLeftovers() {
    if (!state.leftovers.length) {
      leftoverTableBody.innerHTML = '<tr><td colspan="4">No leftover rolls added.</td></tr>';
      return;
    }
    leftoverTableBody.innerHTML = state.leftovers
      .map(
        (item, idx) => `<tr>
          <td>${idx + 1}</td>
          <td>${item.cableSize}</td>
          <td>${formatNumber(item.length)}</td>
          <td><button type="button" class="link-button" data-action="remove" data-index="${idx}">Remove</button></td>
        </tr>`
      )
      .join('');
  }

  function handleLeftoverSubmit(event) {
    event.preventDefault();
    const sizeInput = document.getElementById('leftover-size');
    const lengthInput = document.getElementById('leftover-length');
    const cableSize = sizeInput.value.trim();
    const lengthVal = parseFloat(lengthInput.value);
    if (!cableSize || Number.isNaN(lengthVal) || lengthVal <= 0) {
      setStatus('Provide a cable size and a positive leftover length.', 'warning');
      return;
    }
    state.leftovers.push({ cableSize, length: lengthVal });
    renderLeftovers();
    sizeInput.value = '';
    lengthInput.value = '';
    setStatus('Leftover roll added.');
  }

  function handleLeftoverClick(event) {
    const target = event.target;
    if (target?.dataset?.action === 'remove') {
      const idx = Number(target.dataset.index);
      state.leftovers.splice(idx, 1);
      renderLeftovers();
    }
  }

  function renderSummary(metrics) {
    if (!metrics) {
      summaryEl.innerHTML = '';
      return;
    }

    const shortageBadge =
      metrics.totalShortage > 0
        ? `<span class="danger">Shortage ${formatNumber(metrics.totalShortage)} ft across ${metrics.shortageRolls} roll(s)</span>`
        : '<span class="badge">No shortages planned</span>';

    // Calculate floor mixing statistics
    const mixedFloorRolls = state.assignments.filter(roll => roll.floors.length > 1).length;
    const singleFloorRolls = state.assignments.filter(roll => roll.floors.length === 1).length;
    const floorIsolationRate = state.assignments.length > 0
      ? Math.round((singleFloorRolls / state.assignments.length) * 100)
      : 0;

    const floorMixingBadge = mixedFloorRolls === 0
      ? '<span class="badge" style="background: #10b981; color: white;">✓ Perfect floor isolation</span>'
      : `<span class="badge" style="background: #f59e0b; color: white;">⚠ ${mixedFloorRolls} roll(s) span multiple floors</span>`;

    // Calculate waste vs spare/reusable breakdown
    const wasteThreshold = getWasteThreshold(); // user-defined threshold for waste vs spare
    let totalWaste = 0;
    let totalSpare = 0;

    state.assignments.forEach((roll) => {
      if (roll.remaining > 0) {
        if (roll.remaining < wasteThreshold) {
          totalWaste += roll.remaining;
        } else {
          totalSpare += roll.remaining;
        }
      }
    });

    const cards = [
      `<div class="summary__card">
        <p class="summary__title">Total cable requested</p>
        <p class="summary__value">${formatNumber(metrics.totalRequired)} ft</p>
      </div>`,
      `<div class="summary__card">
        <p class="summary__title">Total actual to cut</p>
        <p class="summary__value">${formatNumber(metrics.totalActual)} ft</p>
      </div>`,
      `<div class="summary__card">
        <p class="summary__title">Rolls used</p>
        <p class="summary__value">${metrics.totalRolls}</p>
        <p class="summary__note">${metrics.newRolls} new · ${metrics.leftoverRollsUsed} leftover</p>
      </div>`,
      `<div class="summary__card">
        <p class="summary__title">True Waste</p>
        <p class="summary__value">${formatNumber(totalWaste)} ft</p>
        <p class="summary__note">Scrap/trash (&lt; ${formatNumber(wasteThreshold)} ft)</p>
      </div>`,
      `<div class="summary__card">
        <p class="summary__title">Spare/Reusable</p>
        <p class="summary__value">${formatNumber(totalSpare)} ft</p>
        <p class="summary__note">Save for next project (≥ ${formatNumber(wasteThreshold)} ft)</p>
      </div>`,
      `<div class="summary__card">
        <p class="summary__title">Floor Isolation</p>
        <p class="summary__value">${floorIsolationRate}%</p>
        <p class="summary__note">${floorMixingBadge}</p>
      </div>`,
    ];

    const perCable = metrics.perCable
      .map(
        (item) => {
          // Calculate waste vs spare for this cable size
          let cableWaste = 0;
          let cableSpare = 0;

          state.assignments
            .filter((roll) => roll.cableSize === item.cableSize)
            .forEach((roll) => {
              if (roll.remaining > 0) {
                if (roll.remaining < wasteThreshold) {
                  cableWaste += roll.remaining;
                } else {
                  cableSpare += roll.remaining;
                }
              }
            });

          return `<li>
            <strong>${item.cableSize}</strong> · ${item.unitsCount} unit(s) · ${item.rolls} roll(s) (${item.newRolls} new, ${item.leftoverRollsUsed} leftover)${
              item.totalShortage > 0 ? ` · <span class="danger">short ${formatNumber(item.totalShortage)} ft</span>` : ''
            }
          </li>`;
        }
      )
      .join('');

    const cableCard = `<div class="summary__card summary__card--wide">
      <p class="summary__title">By cable size</p>
      <ul class="summary__list">${perCable || '<li>No cable data.</li>'}</ul>
    </div>`;

    // Build waste/spare breakdown by cable size
    const wasteBreakdown = metrics.perCable
      .map(item => {
        let cableWaste = 0;
        let cableSpare = 0;
        let wasteRolls = [];
        let spareRolls = [];

        state.assignments
          .filter(roll => roll.cableSize === item.cableSize)
          .forEach((roll) => {
            if (roll.remaining > 0) {
              if (roll.remaining < wasteThreshold) {
                cableWaste += roll.remaining;
                wasteRolls.push(`${roll.id}: ${formatNumber(roll.remaining)}ft`);
              } else {
                cableSpare += roll.remaining;
                spareRolls.push(`${roll.id}: ${formatNumber(roll.remaining)}ft`);
              }
            }
          });

        let details = [];
        if (cableWaste > 0) {
          details.push(`<span class="danger">Waste: ${formatNumber(cableWaste)} ft (${wasteRolls.join(', ')})</span>`);
        }
        if (cableSpare > 0) {
          details.push(`<span style="color: #10b981; font-weight: 500;">Spare: ${formatNumber(cableSpare)} ft (${spareRolls.join(', ')})</span>`);
        }
        if (details.length === 0) {
          details.push('<span style="color: #6b7280;">No leftover</span>');
        }

        return `<li><strong>${item.cableSize}</strong> · ${details.join(' · ')}</li>`;
      })
      .join('');

    const wasteCard = `<div class="summary__card summary__card--wide">
      <p class="summary__title">Waste & Spare Breakdown by Cable Size</p>
      <ul class="summary__list">${wasteBreakdown || '<li>No data.</li>'}</ul>
      <p style="margin-top: 12px; font-size: 0.85em; color: #6b7280;">
        <strong>Note:</strong> Waste (&lt; ${formatNumber(wasteThreshold)} ft) = trash/scrap. Spare (≥ ${formatNumber(wasteThreshold)} ft) = save for next project.
      </p>
    </div>`;

    summaryEl.innerHTML = cards.join('') + cableCard + wasteCard;
  }

  function renderResultsTable(rolls) {
    if (!rolls.length) {
      resultsTableBody.innerHTML = '<tr><td colspan="7">Run optimization to see roll assignments.</td></tr>';
      return;
    }

    const wasteThreshold = getWasteThreshold(); // user-defined threshold for waste vs spare

    resultsTableBody.innerHTML = rolls
      .map((roll) => {
        const unitsDescription = roll.assignments
          .map((assignment) => {
            const base = `${assignment.unit} (${formatNumber(assignment.requestedLength)} ft)`;
            return assignment.shortage > 0 ? `${base} <span class="danger">short ${formatNumber(assignment.shortage)} ft</span>` : base;
          })
          .join(', ');

        const floorLabel = roll.floors.slice().sort().join(', ');
        const isMixedFloor = roll.floors.length > 1;
        const floorWarning = isMixedFloor
          ? `<span class="badge" style="background: #f59e0b; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.85em;">⚠ ${roll.floors.length} floors</span>`
          : '';

        const sourceLabel = roll.source === 'new' ? 'New roll' : 'Leftover roll';

        // Enhanced leftover label with waste/spare distinction
        let leftoverLabel;
        if (roll.shortage > 0) {
          leftoverLabel = `<span class="danger">Short ${formatNumber(roll.shortage)} ft</span>`;
        } else if (roll.remaining >= wasteThreshold) {
          leftoverLabel = `<span style="color: #10b981; font-weight: 500;">${formatNumber(roll.remaining)} ft (spare)</span>`;
        } else if (roll.remaining > 0) {
          leftoverLabel = `<span class="danger">${formatNumber(roll.remaining)} ft (waste)</span>`;
        } else {
          leftoverLabel = `<span style="color: #6b7280;">0 ft</span>`;
        }

        const rowClass = roll.shortage > 0 ? ' class="shortage-row"' : (isMixedFloor ? ' class="mixed-floor-row"' : '');
        return `<tr${rowClass}>
          <td>${roll.id}</td>
          <td>${roll.cableSize}</td>
          <td>${sourceLabel}</td>
          <td>${floorLabel || '—'} ${floorWarning}</td>
          <td>${unitsDescription}</td>
          <td>${formatNumber(roll.totalActual)} ft</td>
          <td>${leftoverLabel}</td>
        </tr>`;
      })
      .join('');
  }

  function handleOptimize() {
    if (!state.rows.length) {
      setStatus('Load an Excel file before running optimization.', 'warning');
      return;
    }

    const rollLength = parseFloat(rollLengthInput.value);
    const tolerance = Math.max(0, parseFloat(toleranceInput.value));
    const toleranceLimitRaw = parseInt(toleranceLimitInput.value, 10);
    const toleranceLimit = Number.isNaN(toleranceLimitRaw) ? 0 : Math.max(0, toleranceLimitRaw);
    const optimizationMode = selectedOptimizationMode;
    const wasteThreshold = getWasteThreshold();

    if (Number.isNaN(rollLength) || rollLength <= 0) {
      setStatus('Roll length must be a positive number.', 'warning');
      return;
    }

    const maxRow = state.rows.reduce(
      (acc, row) => (row.length > acc.length ? { unit: row.unit, length: row.length } : acc),
      { unit: null, length: 0 }
    );

    if (maxRow.length > rollLength + tolerance) {
      setStatus(
        `Unit ${maxRow.unit} needs ${formatNumber(maxRow.length)} ft which exceeds the roll length (${formatNumber(
          rollLength
        )} ft) plus tolerance (${formatNumber(tolerance)} ft). Adjust the inputs or break that run.`,
        'error'
      );
      return;
    }

    setStatus('Running optimization...');
    try {
      const result = runOptimization(state.rows, state.leftovers, {
        rollLength,
        tolerance,
        toleranceLimit,
        optimizationMode,
      });
      state.assignments = result.assignments;
      state.metrics = result.metrics;
      state.meta.toleranceUses = result.toleranceUsed;
      state.meta.algorithmUsed = result.algorithmUsed;
      state.meta.wasteThreshold = wasteThreshold;

      renderSummary(result.metrics);
      renderResultsTable(result.assignments);
      exportButton.disabled = false;
      printResultsButton.disabled = false;

      const modeLabel = {
        'floor-strict': 'Floor Isolation mode',
        'waste-strict': 'Minimize Waste mode',
        'balanced': 'Balanced mode'
      }[optimizationMode] || 'Balanced mode';

      if (result.metrics.totalShortage > 0) {
        setStatus(
          `Optimization complete (${modeLabel}) using ${result.algorithmUsed} with ${formatNumber(
            result.metrics.totalShortage
          )} ft shortage across ${result.metrics.shortageRolls} roll(s).`,
          'warning'
        );
      } else {
        setStatus(`Optimization complete (${modeLabel}) using ${result.algorithmUsed}.`);
      }
    } catch (error) {
      console.error(error);
      setStatus(`Optimization failed: ${error.message}`, 'error');
      resetResults();
    }
  }

  async function handleExport() {
    if (!state.assignments.length) {
      setStatus('Run the optimization before exporting.', 'warning');
      return;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.creator = 'Cable Roll Optimizer';

    const planSheet = workbook.addWorksheet('Roll Plan', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    planSheet.columns = [
      { header: 'Roll ID', key: 'rollId', width: 12 },
      { header: 'Cable Size', key: 'cableSize', width: 18 },
      { header: 'Source', key: 'source', width: 14 },
      { header: 'Floor', key: 'floor', width: 10 },
      { header: 'Unit', key: 'unit', width: 12 },
      { header: 'Requested (ft)', key: 'requested', width: 16 },
      { header: 'Cut Length (ft)', key: 'actual', width: 18 },
      { header: 'Roll Status', key: 'status', width: 16 },
      { header: 'Notes', key: 'notes', width: 28 },
    ];

    const headerRow = planSheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };

    const floorColorMap = new Map();
    let paletteIndex = 0;

    function getFloorColor(floor) {
      if (!floor || floor === 'N/A') {
        return null;
      }
      if (!floorColorMap.has(floor)) {
        const color = floorPalette[paletteIndex % floorPalette.length];
        paletteIndex += 1;
        floorColorMap.set(floor, color);
      }
      return floorColorMap.get(floor);
    }

    state.assignments.forEach((roll) => {
      let firstAssignment = true;
      roll.assignments.forEach((assignment) => {
        const notes =
          assignment.shortage > 0
            ? `Short ${formatNumber(assignment.shortage)} ft. Plan extra stub on site.`
            : '';

        const statusText = firstAssignment
          ? roll.shortage > 0
            ? `Short ${formatNumber(roll.shortage)} ft`
            : `Leftover ${formatNumber(roll.remaining)} ft`
          : '';

        const row = planSheet.addRow({
          rollId: roll.id,
          cableSize: roll.cableSize,
          source: roll.source === 'new' ? 'New roll' : 'Leftover roll',
          floor: assignment.floor,
          unit: assignment.unit,
          requested: assignment.requestedLength,
          actual: assignment.actualLength,
          status: statusText,
          notes,
        });

        row.font = row.font || {};
        row.alignment = {
          vertical: 'middle',
          horizontal: 'left',
        };

        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFD0D7FF' } },
            bottom: { style: 'thin', color: { argb: 'FFD0D7FF' } },
            left: { style: 'thin', color: { argb: 'FFD0D7FF' } },
            right: { style: 'thin', color: { argb: 'FFD0D7FF' } },
          };
        });

        const floorColor = getFloorColor(assignment.floor);
        if (floorColor) {
          row.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: floorColor } };
          });
        }

        if (roll.shortage > 0 || assignment.shortage > 0) {
          row.eachCell((cell) => {
            cell.font = { color: { argb: 'FFB91C1C' }, bold: assignment.shortage > 0 };
          });
        }

        firstAssignment = false;
      });

      if (!roll.assignments.length) {
        const row = planSheet.addRow({
          rollId: roll.id,
          cableSize: roll.cableSize,
          source: roll.source === 'new' ? 'New roll' : 'Leftover roll',
          floor: '—',
          unit: '—',
          requested: 0,
          actual: 0,
          status: roll.shortage > 0 ? `Short ${formatNumber(roll.shortage)} ft` : `Leftover ${formatNumber(roll.remaining)} ft`,
          notes: 'Roll reserved, no assignments.',
        });
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        });
      }
    });

    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 24 },
    ];

    summarySheet.getRow(1).font = { bold: true };

    const metrics = state.metrics;
    summarySheet.addRows([
      { metric: 'Algorithm used', value: state.meta.algorithmUsed || 'N/A' },
      { metric: 'Total cable requested (ft)', value: formatNumber(metrics.totalRequired) },
      { metric: 'Total actual to cut (ft)', value: formatNumber(metrics.totalActual) },
      { metric: 'Total leftover (ft)', value: formatNumber(metrics.totalLeftover) },
      { metric: 'Total shortage (ft)', value: formatNumber(metrics.totalShortage) },
      { metric: 'Rolls used', value: metrics.totalRolls },
      { metric: 'New rolls', value: metrics.newRolls },
      { metric: 'Leftover rolls used', value: metrics.leftoverRollsUsed },
      { metric: 'Tolerance uses', value: state.meta.toleranceUses },
    ]);

    summarySheet.addRow({});
    summarySheet.addRow({ metric: 'Per cable size' });
    metrics.perCable.forEach((item) => {
      summarySheet.addRow({
        metric: `• ${item.cableSize}`,
        value: `${item.unitsCount} units | rolls ${item.rolls} (${item.newRolls} new, ${item.leftoverRollsUsed} leftover) | leftover ${formatNumber(
          item.totalLeftover
        )} ft${item.totalShortage > 0 ? ` | short ${formatNumber(item.totalShortage)} ft` : ''}`,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cable-roll-plan-${Date.now()}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);

    setStatus('Excel plan exported.');
  }

  function runOptimization(rows, leftovers, options) {
    const toleranceLimit = Number.isFinite(options.toleranceLimit)
      ? options.toleranceLimit
      : 0;

    // Run multiple algorithms and compare results
    const algorithms = [
      { name: 'Floor Dedicated (Strict)', fn: optimizeFloorDedicatedStrict },
      { name: 'Floor-First Greedy', fn: optimizeFloorFirstGreedy },
      { name: 'Best Fit Decreasing', fn: optimizeBestFitDecreasing },
      { name: 'First Fit Decreasing', fn: optimizeFirstFitDecreasing },
      { name: 'Dynamic Programming', fn: optimizeDynamicProgramming },
      { name: 'Genetic Algorithm', fn: optimizeGeneticAlgorithm },
    ];

    const results = algorithms.map((algo) => {
      const meta = {
        toleranceUsed: 0,
        toleranceLimit: toleranceLimit === 0 ? 0 : toleranceLimit,
      };

      const leftoversBySize = new Map();
      leftovers.forEach((item) => {
        const key = item.cableSize.trim().toLowerCase();
        if (!leftoversBySize.has(key)) {
          leftoversBySize.set(key, []);
        }
        leftoversBySize.get(key).push({ cableSize: item.cableSize, length: item.length });
      });
      leftoversBySize.forEach((arr) => arr.sort((a, b) => b.length - a.length));

      const unitsByCable = new Map();
      rows.forEach((row) => {
        const key = row.cableSize.trim().toLowerCase();
        if (!unitsByCable.has(key)) {
          unitsByCable.set(key, []);
        }
        unitsByCable.get(key).push({ ...row });
      });

      const rollCounters = { new: 1, leftover: 1 };
      const nextRollId = (source) => {
        const prefix = source === 'leftover' ? 'L' : 'N';
        const idx = rollCounters[source]++;
        return `${prefix}-${String(idx).padStart(3, '0')}`;
      };

      const assignments = [];
      const metrics = {
        totalUnits: rows.length,
        totalRequired: rows.reduce((sum, row) => sum + row.length, 0),
        totalActual: 0,
        totalLeftover: 0,
        totalShortage: 0,
        totalRolls: 0,
        newRolls: 0,
        leftoverRollsUsed: 0,
        shortageRolls: 0,
        perCable: [],
      };

      for (const [key, units] of unitsByCable.entries()) {
        const displayCable = units[0]?.cableSize ?? key;
        const leftoverEntries = leftoversBySize.get(key) ?? [];

        const result = algo.fn(displayCable, units, leftoverEntries, options, meta, nextRollId);
        assignments.push(...result.rolls);

        metrics.totalActual += result.stats.totalActual;
        metrics.totalLeftover += result.stats.totalLeftover;
        metrics.totalShortage += result.stats.totalShortage;
        metrics.newRolls += result.stats.newRolls;
        metrics.leftoverRollsUsed += result.stats.leftoverRollsUsed;
        metrics.perCable.push(result.stats);
      }

      metrics.totalRolls = assignments.length;
      metrics.shortageRolls = assignments.filter((roll) => roll.shortage > 0).length;

      // Count floor mixing violations
      const floorMixingPenalty = assignments.reduce((sum, roll) => {
        return sum + (roll.floors.length > 1 ? roll.floors.length - 1 : 0);
      }, 0);

      // Determine floor mixing penalty weight based on optimization mode
      let floorMixingWeight;
      let rollCountWeight;
      switch (options.optimizationMode) {
        case 'floor-strict':
          // MAXIMUM floor isolation - almost as important as preventing shortages
          floorMixingWeight = 5000;
          rollCountWeight = 5;
          break;
        case 'waste-strict':
          // Minimal floor penalty - prioritize waste reduction and roll count
          floorMixingWeight = 10;
          rollCountWeight = 50;
          break;
        case 'balanced':
        default:
          // Balanced approach - strong but not extreme floor penalty
          floorMixingWeight = 500;
          rollCountWeight = 10;
          break;
      }

      // Score: lower is better
      // Priority order changes based on mode:
      // - floor-strict: 1. Shortage, 2. Floor isolation, 3. Waste, 4. Roll count
      // - waste-strict: 1. Shortage, 2. Waste, 3. Roll count, 4. Floor isolation
      // - balanced: 1. Shortage, 2. Floor isolation (moderate), 3. Waste, 4. Roll count
      const score =
        metrics.totalShortage * 10000 +
        floorMixingPenalty * floorMixingWeight +
        metrics.totalLeftover +
        metrics.totalRolls * rollCountWeight;

      return {
        algorithmName: algo.name,
        assignments,
        metrics,
        toleranceUsed: meta.toleranceUsed,
        score,
        floorMixingPenalty,
      };
    });

    // Select the best result
    results.sort((a, b) => a.score - b.score);
    const best = results[0];

    console.log('Algorithm Comparison:');
    results.forEach((r) => {
      console.log(
        `  ${r.algorithmName}: Score=${r.score}, Leftover=${formatNumber(r.metrics.totalLeftover)}ft, Shortage=${formatNumber(
          r.metrics.totalShortage
        )}ft, FloorMixing=${r.floorMixingPenalty}, Rolls=${r.metrics.totalRolls}`
      );
    });
    console.log(`Winner: ${best.algorithmName}`);

    // POST-OPTIMIZATION: Consolidate leftovers - replace small new rolls with large leftovers
    const optimized = consolidateLeftovers(best.assignments, options);

    return {
      assignments: optimized.assignments,
      metrics: optimized.metrics,
      toleranceUsed: best.toleranceUsed,
      algorithmUsed: best.algorithmName,
    };
  }

  // Post-optimization: Replace new rolls with leftover space from other rolls
  function consolidateLeftovers(assignments) {
    const rolls = assignments.map(roll => ({
      ...roll,
      assignments: roll.assignments.map(a => ({ ...a })),
      floors: [...roll.floors]
    }));

    // Find new rolls that could be consolidated (sorted by total usage, smallest first)
    const candidateNewRolls = rolls
      .filter(roll => roll.source === 'new' && roll.shortage === 0)
      .sort((a, b) => a.totalActual - b.totalActual);

    // Find rolls with large leftovers (sorted by leftover, largest first)
    const rollsWithLeftover = rolls
      .filter(roll => roll.remaining >= 30 && roll.shortage === 0) // At least 30ft leftover
      .sort((a, b) => b.remaining - a.remaining);

    let consolidationsMade = 0;

    // Try to consolidate each small new roll
    candidateNewRolls.forEach(newRoll => {
      if (newRoll.assignments.length === 0) return; // Already consolidated

      // Find a leftover roll that can fit all units from this new roll
      for (const leftoverRoll of rollsWithLeftover) {
        if (leftoverRoll.id === newRoll.id) continue; // Skip self

        // Check if leftover can fit all units from new roll
        if (leftoverRoll.remaining >= newRoll.totalActual) {
          // Check floor mixing penalty
          const currentFloors = new Set(leftoverRoll.floors);
          const wouldMixFloors = ![...newRoll.floors].every(f => currentFloors.has(f));

          // Only consolidate if:
          // 1. Same cable size
          // 2. Either same floor OR leftover is very large (>500ft) making it worth the floor mixing
          const sameCableSize = leftoverRoll.cableSize === newRoll.cableSize;
          const worthConsolidating = !wouldMixFloors || leftoverRoll.remaining > 500;

          if (sameCableSize && worthConsolidating) {
            console.log(`✓ Consolidation: Moving ${newRoll.totalActual}ft from new roll ${newRoll.id} to roll ${leftoverRoll.id} (has ${leftoverRoll.remaining}ft available)`);

            // Move all assignments from newRoll to leftoverRoll
            newRoll.assignments.forEach(assignment => {
              leftoverRoll.assignments.push(assignment);
              leftoverRoll.floors.push(assignment.floor);
              leftoverRoll.totalActual += assignment.actualLength;
              leftoverRoll.totalRequested += assignment.requestedLength;
              leftoverRoll.remaining -= assignment.actualLength;
            });

            // Deduplicate floors
            leftoverRoll.floors = Array.from(new Set(leftoverRoll.floors));

            // Mark new roll as consolidated (empty it)
            newRoll.assignments = [];
            newRoll.totalActual = 0;
            newRoll.totalRequested = 0;
            newRoll.remaining = newRoll.capacity;

            consolidationsMade++;
            break; // Move to next new roll
          }
        }
      }
    });

    if (consolidationsMade > 0) {
      console.log(`✓ Successfully consolidated ${consolidationsMade} new roll(s) into existing leftovers, saving ${consolidationsMade} roll(s)!`);
    }

    // Filter out empty rolls (consolidated ones)
    const finalRolls = rolls.filter(roll => roll.assignments.length > 0);

    // Recalculate metrics
    const totalUnits = finalRolls.reduce((sum, roll) => sum + roll.assignments.length, 0);
    const totalRequired = finalRolls.reduce((sum, roll) => sum + roll.totalRequested, 0);
    const totalActual = finalRolls.reduce((sum, roll) => sum + roll.totalActual, 0);
    const totalLeftover = finalRolls.reduce((sum, roll) => sum + roll.remaining, 0);
    const totalShortage = finalRolls.reduce((sum, roll) => sum + roll.shortage, 0);
    const newRollsCount = finalRolls.filter(roll => roll.source === 'new').length;
    const leftoverRollsUsed = finalRolls.filter(roll => roll.source === 'leftover').length;
    const shortageRolls = finalRolls.filter(roll => roll.shortage > 0).length;

    // Group by cable size for perCable stats
    const cableSizeMap = new Map();
    finalRolls.forEach(roll => {
      if (!cableSizeMap.has(roll.cableSize)) {
        cableSizeMap.set(roll.cableSize, {
          cableSize: roll.cableSize,
          unitsCount: 0,
          rolls: 0,
          newRolls: 0,
          leftoverRollsUsed: 0,
          totalLeftover: 0,
          totalShortage: 0,
          totalActual: 0,
          totalRequired: 0,
        });
      }
      const stats = cableSizeMap.get(roll.cableSize);
      stats.unitsCount += roll.assignments.length;
      stats.rolls++;
      if (roll.source === 'new') stats.newRolls++;
      if (roll.source === 'leftover') stats.leftoverRollsUsed++;
      stats.totalLeftover += roll.remaining;
      stats.totalShortage += roll.shortage;
      stats.totalActual += roll.totalActual;
      stats.totalRequired += roll.totalRequested;
    });

    const metrics = {
      totalUnits,
      totalRequired,
      totalActual,
      totalLeftover,
      totalShortage,
      totalRolls: finalRolls.length,
      newRolls: newRollsCount,
      leftoverRollsUsed,
      shortageRolls,
      perCable: Array.from(cableSizeMap.values()),
    };

    return { assignments: finalRolls, metrics };
  }

  // STRICT Floor Dedicated Algorithm - Each roll used on ONE floor only
  function optimizeFloorDedicatedStrict(cableSize, units, leftoverEntries, options, meta, nextRollId) {
    const rollLength = options.rollLength;
    const tolerance = options.tolerance;

    // Group units by floor
    const floorMap = new Map();
    units.forEach((unit) => {
      if (!floorMap.has(unit.floor)) {
        floorMap.set(unit.floor, []);
      }
      floorMap.get(unit.floor).push({ ...unit });
    });

    // Sort floors by total cable demand (descending)
    const floors = Array.from(floorMap.entries())
      .map(([floor, unitsList]) => ({
        floor,
        units: unitsList.sort((a, b) => b.length - a.length), // Largest units first
        total: unitsList.reduce((sum, unit) => sum + unit.length, 0),
      }))
      .sort((a, b) => b.total - a.total);

    const allRolls = [];

    // Process each floor completely independently
    floors.forEach((floorItem) => {
      const floorRolls = [];

      // First, try to use leftover rolls for this floor only
      leftoverEntries.forEach((entry) => {
        const roll = createRoll(nextRollId('leftover'), cableSize, entry.length, 'leftover');
        floorRolls.push(roll);
      });

      // Process units on this floor
      floorItem.units.forEach((unit) => {
        // Try to fit in existing floor-dedicated rolls (same floor only)
        let placed = false;

        // Best Fit: Find roll with minimum waste that can fit this unit
        let bestRoll = null;
        let bestWaste = Infinity;

        for (const roll of floorRolls) {
          if (roll.shortage === 0 && roll.remaining >= unit.length) {
            const waste = roll.remaining - unit.length;
            if (waste < bestWaste) {
              bestWaste = waste;
              bestRoll = roll;
            }
          }
        }

        if (bestRoll) {
          commitUnit(bestRoll, unit, 0, meta);
          placed = true;
        }

        // Try tolerance on existing rolls (same floor only)
        if (!placed && tolerance > 0 && meta.toleranceUsed < meta.toleranceLimit) {
          for (const roll of floorRolls) {
            if (roll.shortage === 0 && roll.remaining > 0) {
              const shortage = unit.length - roll.remaining;
              if (shortage > 0 && shortage <= tolerance) {
                commitUnit(roll, unit, shortage, meta);
                placed = true;
                break;
              }
            }
          }
        }

        // Create new roll dedicated to this floor
        if (!placed) {
          const newRoll = createRoll(nextRollId('new'), cableSize, rollLength, 'new');
          floorRolls.push(newRoll);
          commitUnit(newRoll, unit, 0, meta);
        }
      });

      // Add floor rolls to all rolls
      allRolls.push(...floorRolls.filter(roll => roll.assignments.length > 0));
    });

    const usedRolls = allRolls.map((roll) => ({
      id: roll.id,
      cableSize: roll.cableSize,
      source: roll.source,
      capacity: roll.capacity,
      remaining: Math.max(0, roll.remaining),
      shortage: roll.shortage,
      assignments: roll.assignments.map((assignment) => ({ ...assignment })),
      floors: Array.from(roll.floors),
      totalRequested: roll.totalRequested,
      totalActual: roll.totalActual,
    }));

    const stats = {
      cableSize,
      unitsCount: units.length,
      rolls: usedRolls.length,
      newRolls: usedRolls.filter((roll) => roll.source === 'new').length,
      leftoverRollsUsed: usedRolls.filter((roll) => roll.source === 'leftover').length,
      totalLeftover: usedRolls.reduce((sum, roll) => sum + roll.remaining, 0),
      totalShortage: usedRolls.reduce((sum, roll) => sum + roll.shortage, 0),
      totalActual: usedRolls.reduce((sum, roll) => sum + roll.totalActual, 0),
      totalRequired: units.reduce((sum, unit) => sum + unit.length, 0),
    };

    return { rolls: usedRolls, stats };
  }

  function optimizeBestFitDecreasing(cableSize, units, leftoverEntries, options, meta, nextRollId) {
    const rolls = [];
    leftoverEntries.forEach((entry) => {
      rolls.push(createRoll(nextRollId('leftover'), cableSize, entry.length, 'leftover'));
    });

    const rollLength = options.rollLength;
    const tolerance = options.tolerance;

    // Sort units by length (descending) - Best Fit Decreasing
    const sortedUnits = [...units].sort((a, b) => b.length - a.length);

    sortedUnits.forEach((unit) => {
      // Find the roll with the least remaining space that can fit this unit
      const candidates = rolls.filter(
        (roll) => roll.shortage === 0 && roll.remaining >= unit.length
      );

      if (candidates.length > 0) {
        // Best Fit: choose roll with minimum remaining after assignment
        candidates.sort((a, b) => {
          const remainA = a.remaining - unit.length;
          const remainB = b.remaining - unit.length;
          if (remainA !== remainB) return remainA - remainB;
          // Tie-breaker: prefer same floor
          const floorPenaltyA = rollFloorPenalty(a, unit.floor);
          const floorPenaltyB = rollFloorPenalty(b, unit.floor);
          if (floorPenaltyA !== floorPenaltyB) return floorPenaltyA - floorPenaltyB;
          return a.source === 'leftover' ? -1 : 1;
        });
        commitUnit(candidates[0], unit, 0, meta);
        return;
      }

      // Try tolerance
      const toleranceRemaining = meta.toleranceLimit === 0 ? 0 : meta.toleranceLimit - meta.toleranceUsed;
      if (tolerance > 0 && toleranceRemaining > 0) {
        const toleranceCandidates = rolls
          .filter((roll) => roll.shortage === 0 && roll.remaining > 0)
          .map((roll) => ({ roll, shortage: unit.length - roll.remaining }))
          .filter((item) => item.shortage > 0 && item.shortage <= tolerance);

        if (toleranceCandidates.length > 0) {
          toleranceCandidates.sort((a, b) => a.shortage - b.shortage);
          const { roll, shortage } = toleranceCandidates[0];
          commitUnit(roll, unit, shortage, meta);
          return;
        }
      }

      // Create new roll
      const newRoll = createRoll(nextRollId('new'), cableSize, rollLength, 'new');
      rolls.push(newRoll);
      commitUnit(newRoll, unit, 0, meta);
    });

    const usedRolls = rolls
      .filter((roll) => roll.assignments.length > 0)
      .map((roll) => ({
        id: roll.id,
        cableSize: roll.cableSize,
        source: roll.source,
        capacity: roll.capacity,
        remaining: Math.max(0, roll.remaining),
        shortage: roll.shortage,
        assignments: roll.assignments.map((assignment) => ({ ...assignment })),
        floors: Array.from(roll.floors),
        totalRequested: roll.totalRequested,
        totalActual: roll.totalActual,
      }));

    const stats = {
      cableSize,
      unitsCount: units.length,
      rolls: usedRolls.length,
      newRolls: usedRolls.filter((roll) => roll.source === 'new').length,
      leftoverRollsUsed: usedRolls.filter((roll) => roll.source === 'leftover').length,
      totalLeftover: usedRolls.reduce((sum, roll) => sum + roll.remaining, 0),
      totalShortage: usedRolls.reduce((sum, roll) => sum + roll.shortage, 0),
      totalActual: usedRolls.reduce((sum, roll) => sum + roll.totalActual, 0),
      totalRequired: units.reduce((sum, unit) => sum + unit.length, 0),
    };

    return { rolls: usedRolls, stats };
  }

  function optimizeFirstFitDecreasing(cableSize, units, leftoverEntries, options, meta, nextRollId) {
    const rolls = [];
    leftoverEntries.forEach((entry) => {
      rolls.push(createRoll(nextRollId('leftover'), cableSize, entry.length, 'leftover'));
    });

    const rollLength = options.rollLength;
    const tolerance = options.tolerance;

    // Sort units by length (descending) - First Fit Decreasing
    const sortedUnits = [...units].sort((a, b) => b.length - a.length);

    sortedUnits.forEach((unit) => {
      // First Fit: find the first roll that can fit this unit, prefer same floor
      const sameFlorCandidates = rolls.filter(
        (roll) => roll.shortage === 0 && roll.remaining >= unit.length &&
        (roll.floors.size === 0 || roll.floors.has(unit.floor))
      );

      if (sameFlorCandidates.length > 0) {
        commitUnit(sameFlorCandidates[0], unit, 0, meta);
        return;
      }

      // Try any roll
      const anyCandidates = rolls.filter(
        (roll) => roll.shortage === 0 && roll.remaining >= unit.length
      );

      if (anyCandidates.length > 0) {
        commitUnit(anyCandidates[0], unit, 0, meta);
        return;
      }

      // Try tolerance
      const toleranceRemaining = meta.toleranceLimit === 0 ? 0 : meta.toleranceLimit - meta.toleranceUsed;
      if (tolerance > 0 && toleranceRemaining > 0) {
        const toleranceCandidates = rolls
          .filter((roll) => roll.shortage === 0 && roll.remaining > 0)
          .map((roll) => ({ roll, shortage: unit.length - roll.remaining }))
          .filter((item) => item.shortage > 0 && item.shortage <= tolerance);

        if (toleranceCandidates.length > 0) {
          toleranceCandidates.sort((a, b) => a.shortage - b.shortage);
          const { roll, shortage } = toleranceCandidates[0];
          commitUnit(roll, unit, shortage, meta);
          return;
        }
      }

      // Create new roll
      const newRoll = createRoll(nextRollId('new'), cableSize, rollLength, 'new');
      rolls.push(newRoll);
      commitUnit(newRoll, unit, 0, meta);
    });

    const usedRolls = rolls
      .filter((roll) => roll.assignments.length > 0)
      .map((roll) => ({
        id: roll.id,
        cableSize: roll.cableSize,
        source: roll.source,
        capacity: roll.capacity,
        remaining: Math.max(0, roll.remaining),
        shortage: roll.shortage,
        assignments: roll.assignments.map((assignment) => ({ ...assignment })),
        floors: Array.from(roll.floors),
        totalRequested: roll.totalRequested,
        totalActual: roll.totalActual,
      }));

    const stats = {
      cableSize,
      unitsCount: units.length,
      rolls: usedRolls.length,
      newRolls: usedRolls.filter((roll) => roll.source === 'new').length,
      leftoverRollsUsed: usedRolls.filter((roll) => roll.source === 'leftover').length,
      totalLeftover: usedRolls.reduce((sum, roll) => sum + roll.remaining, 0),
      totalShortage: usedRolls.reduce((sum, roll) => sum + roll.shortage, 0),
      totalActual: usedRolls.reduce((sum, roll) => sum + roll.totalActual, 0),
      totalRequired: units.reduce((sum, unit) => sum + unit.length, 0),
    };

    return { rolls: usedRolls, stats };
  }

  function optimizeFloorFirstGreedy(cableSize, units, leftoverEntries, options, meta, nextRollId) {
    const rolls = [];
    leftoverEntries.forEach((entry) => {
      rolls.push(createRoll(nextRollId('leftover'), cableSize, entry.length, 'leftover'));
    });

    const rollLength = options.rollLength;
    const tolerance = options.tolerance;

    const floorMap = new Map();
    units.forEach((unit) => {
      if (!floorMap.has(unit.floor)) {
        floorMap.set(unit.floor, []);
      }
      floorMap.get(unit.floor).push({ ...unit });
    });

    const floors = Array.from(floorMap.entries())
      .map(([floor, unitsList]) => ({
        floor,
        units: unitsList.sort((a, b) => b.length - a.length),
        total: unitsList.reduce((sum, unit) => sum + unit.length, 0),
      }))
      .sort((a, b) => b.total - a.total);

    floors.forEach((floorItem) => {
      floorItem.units.forEach((unit) => {
        const strictCandidates = rolls.filter(
          (roll) => roll.shortage === 0 && (roll.floors.size === 0 || roll.floors.has(unit.floor))
        );
        if (attemptAssignment(strictCandidates, unit, tolerance, meta)) {
          return;
        }

        const allCandidates = rolls.filter((roll) => roll.shortage === 0);
        if (attemptAssignment(allCandidates, unit, tolerance, meta, true)) {
          return;
        }

        const newRoll = createRoll(nextRollId('new'), cableSize, rollLength, 'new');
        rolls.push(newRoll);
        commitUnit(newRoll, unit, 0, meta);
      });
    });

    const usedRolls = rolls
      .filter((roll) => roll.assignments.length > 0)
      .map((roll) => ({
        id: roll.id,
        cableSize: roll.cableSize,
        source: roll.source,
        capacity: roll.capacity,
        remaining: Math.max(0, roll.remaining),
        shortage: roll.shortage,
        assignments: roll.assignments.map((assignment) => ({ ...assignment })),
        floors: Array.from(roll.floors),
        totalRequested: roll.totalRequested,
        totalActual: roll.totalActual,
      }));

    const stats = {
      cableSize,
      unitsCount: units.length,
      rolls: usedRolls.length,
      newRolls: usedRolls.filter((roll) => roll.source === 'new').length,
      leftoverRollsUsed: usedRolls.filter((roll) => roll.source === 'leftover').length,
      totalLeftover: usedRolls.reduce((sum, roll) => sum + roll.remaining, 0),
      totalShortage: usedRolls.reduce((sum, roll) => sum + roll.shortage, 0),
      totalActual: usedRolls.reduce((sum, roll) => sum + roll.totalActual, 0),
      totalRequired: units.reduce((sum, unit) => sum + unit.length, 0),
    };

    return { rolls: usedRolls, stats };
  }

  function createRoll(id, cableSize, capacity, source) {
    return {
      id,
      cableSize,
      capacity,
      source,
      remaining: capacity,
      shortage: 0,
      assignments: [],
      floors: new Set(),
      totalRequested: 0,
      totalActual: 0,
    };
  }

  function attemptAssignment(candidates, unit, tolerance, meta, allowMixing = false) {
    if (!candidates.length) {
      return false;
    }

    const directCandidates = candidates.filter((roll) => roll.remaining >= unit.length);
    if (directCandidates.length) {
      const chosen = selectBestRoll(directCandidates, unit, allowMixing);
      commitUnit(chosen, unit, 0, meta);
      return true;
    }

    const toleranceRemaining =
      meta.toleranceLimit === 0 ? 0 : meta.toleranceLimit - meta.toleranceUsed;
    if (!tolerance || toleranceRemaining <= 0) {
      return false;
    }

    const toleranceCandidates = candidates
      .filter((roll) => roll.remaining > 0)
      .map((roll) => ({ roll, shortage: unit.length - roll.remaining }))
      .filter((item) => item.shortage > 0 && item.shortage <= tolerance);

    if (!toleranceCandidates.length) {
      return false;
    }

    toleranceCandidates.sort((a, b) => {
      const floorPenaltyA = rollFloorPenalty(a.roll, unit.floor);
      const floorPenaltyB = rollFloorPenalty(b.roll, unit.floor);
      if (floorPenaltyA !== floorPenaltyB) {
        return floorPenaltyA - floorPenaltyB;
      }
      if (a.shortage !== b.shortage) {
        return a.shortage - b.shortage;
      }
      const sourcePenaltyA = a.roll.source === 'leftover' ? 0 : 1;
      const sourcePenaltyB = b.roll.source === 'leftover' ? 0 : 1;
      if (sourcePenaltyA !== sourcePenaltyB) {
        return sourcePenaltyA - sourcePenaltyB;
      }
      return a.roll.remaining - b.roll.remaining;
    });

    const { roll, shortage } = toleranceCandidates[0];
    commitUnit(roll, unit, shortage, meta);
    return true;
  }

  function selectBestRoll(candidates, unit, allowMixing) {
    const scored = candidates.map((roll) => {
      const floorPenalty = rollFloorPenalty(roll, unit.floor);
      const leftoverAfter = roll.remaining - unit.length;
      const sourcePenalty = roll.source === 'leftover' ? 0 : 1;
      const assignmentPenalty = roll.assignments.length;
      return { roll, floorPenalty, leftoverAfter, sourcePenalty, assignmentPenalty };
    });

    scored.sort((a, b) => {
      if (a.floorPenalty !== b.floorPenalty) {
        return a.floorPenalty - b.floorPenalty;
      }
      if (a.leftoverAfter !== b.leftoverAfter) {
        return a.leftoverAfter - b.leftoverAfter;
      }
      if (a.sourcePenalty !== b.sourcePenalty) {
        return a.sourcePenalty - b.sourcePenalty;
      }
      return a.assignmentPenalty - b.assignmentPenalty;
    });

    return scored[0].roll;
  }

  function rollFloorPenalty(roll, floor) {
    if (!floor || floor === 'N/A') return 1;
    if (roll.floors.size === 0) return 0;
    return roll.floors.has(floor) ? 0 : 1;
  }

  function commitUnit(roll, unit, shortage, meta) {
    const actualLength = unit.length - shortage;
    roll.assignments.push({
      unit: unit.unit,
      floor: unit.floor,
      requestedLength: unit.length,
      actualLength: actualLength,
      shortage,
    });
    roll.floors.add(unit.floor);
    roll.totalRequested += unit.length;
    roll.totalActual += actualLength;

    if (shortage > 0) {
      roll.shortage += shortage;
      roll.remaining = 0;
      meta.toleranceUsed += 1;
    } else {
      roll.remaining = Math.max(0, roll.remaining - actualLength);
    }
  }

  // Advanced Dynamic Programming Algorithm
  function optimizeDynamicProgramming(cableSize, units, leftoverEntries, options, meta, nextRollId) {
    const rolls = [];
    leftoverEntries.forEach((entry) => {
      rolls.push(createRoll(nextRollId('leftover'), cableSize, entry.length, 'leftover'));
    });

    const rollLength = options.rollLength;
    const tolerance = options.tolerance;

    // Group units by floor for floor-priority optimization
    const floorMap = new Map();
    units.forEach((unit) => {
      if (!floorMap.has(unit.floor)) {
        floorMap.set(unit.floor, []);
      }
      floorMap.get(unit.floor).push({ ...unit });
    });

    // Sort floors by total demand (descending)
    const floors = Array.from(floorMap.entries())
      .map(([floor, unitsList]) => ({
        floor,
        units: unitsList.sort((a, b) => b.length - a.length),
        total: unitsList.reduce((sum, unit) => sum + unit.length, 0),
      }))
      .sort((a, b) => b.total - a.total);

    // DP approach: For each floor, find optimal packing using dynamic programming
    floors.forEach((floorItem) => {
      const floorUnits = floorItem.units;

      // Try to pack units optimally using DP knapsack variant
      const packed = packUnitsDP(floorUnits, rolls, rollLength, tolerance, meta, floorItem.floor);

      // Assign packed units
      packed.forEach(({ roll, unit, shortage }) => {
        commitUnit(roll, unit, shortage, meta);
      });

      // Create new rolls for remaining units
      const remainingUnits = floorUnits.filter(
        (unit) => !packed.some((p) => p.unit.unit === unit.unit)
      );

      remainingUnits.forEach((unit) => {
        const newRoll = createRoll(nextRollId('new'), cableSize, rollLength, 'new');
        rolls.push(newRoll);
        commitUnit(newRoll, unit, 0, meta);
      });
    });

    const usedRolls = rolls
      .filter((roll) => roll.assignments.length > 0)
      .map((roll) => ({
        id: roll.id,
        cableSize: roll.cableSize,
        source: roll.source,
        capacity: roll.capacity,
        remaining: Math.max(0, roll.remaining),
        shortage: roll.shortage,
        assignments: roll.assignments.map((assignment) => ({ ...assignment })),
        floors: Array.from(roll.floors),
        totalRequested: roll.totalRequested,
        totalActual: roll.totalActual,
      }));

    const stats = {
      cableSize,
      unitsCount: units.length,
      rolls: usedRolls.length,
      newRolls: usedRolls.filter((roll) => roll.source === 'new').length,
      leftoverRollsUsed: usedRolls.filter((roll) => roll.source === 'leftover').length,
      totalLeftover: usedRolls.reduce((sum, roll) => sum + roll.remaining, 0),
      totalShortage: usedRolls.reduce((sum, roll) => sum + roll.shortage, 0),
      totalActual: usedRolls.reduce((sum, roll) => sum + roll.totalActual, 0),
      totalRequired: units.reduce((sum, unit) => sum + unit.length, 0),
    };

    return { rolls: usedRolls, stats };
  }

  // DP packing helper: optimal assignment of units to existing rolls
  function packUnitsDP(units, rolls, rollLength, tolerance, meta, currentFloor) {
    const assignments = [];
    const availableRolls = rolls.filter((roll) => roll.shortage === 0);

    // For each unit, use DP to find best roll assignment
    units.forEach((unit) => {
      let bestRoll = null;
      let bestShortage = Infinity;
      let bestWaste = Infinity;

      availableRolls.forEach((roll) => {
        const canFitExact = roll.remaining >= unit.length;
        const shortage = canFitExact ? 0 : unit.length - roll.remaining;
        const isWithinTolerance = shortage <= tolerance && shortage > 0;
        const canUseTolerance = meta.toleranceLimit === 0 ? false : meta.toleranceUsed < meta.toleranceLimit;

        if (canFitExact) {
          const waste = roll.remaining - unit.length;
          const floorPenalty = rollFloorPenalty(roll, currentFloor);
          const totalPenalty = waste + floorPenalty * 100;

          if (totalPenalty < bestWaste) {
            bestRoll = roll;
            bestShortage = 0;
            bestWaste = totalPenalty;
          }
        } else if (isWithinTolerance && canUseTolerance) {
          if (shortage < bestShortage) {
            bestRoll = roll;
            bestShortage = shortage;
            bestWaste = 0;
          }
        }
      });

      if (bestRoll) {
        assignments.push({ roll: bestRoll, unit, shortage: bestShortage });
        // Temporarily mark this roll as used for this iteration
        const idx = availableRolls.indexOf(bestRoll);
        if (idx >= 0) availableRolls.splice(idx, 1);
      }
    });

    return assignments;
  }

  // Genetic Algorithm for global optimization
  function optimizeGeneticAlgorithm(cableSize, units, leftoverEntries, options, meta, nextRollId) {
    const rollLength = options.rollLength;
    const tolerance = options.tolerance;

    // GA Parameters
    const POPULATION_SIZE = 50;
    const GENERATIONS = 100;
    const MUTATION_RATE = 0.15;
    const ELITE_SIZE = 5;

    // Initialize population with random solutions
    const population = [];
    for (let i = 0; i < POPULATION_SIZE; i++) {
      const individual = createRandomSolution(units, leftoverEntries, rollLength, cableSize, nextRollId);
      population.push(individual);
    }

    let bestSolution = null;
    let bestFitness = Infinity;

    // Evolve population
    for (let gen = 0; gen < GENERATIONS; gen++) {
      // Evaluate fitness
      population.forEach((individual) => {
        individual.fitness = evaluateSolution(individual, tolerance, meta);
      });

      // Sort by fitness (lower is better)
      population.sort((a, b) => a.fitness - b.fitness);

      // Track best solution
      if (population[0].fitness < bestFitness) {
        bestFitness = population[0].fitness;
        bestSolution = JSON.parse(JSON.stringify(population[0]));
      }

      // Early termination if perfect solution found
      if (bestFitness === 0) break;

      // Selection and crossover
      const newPopulation = [];

      // Keep elite individuals
      for (let i = 0; i < ELITE_SIZE; i++) {
        newPopulation.push(population[i]);
      }

      // Generate offspring
      while (newPopulation.length < POPULATION_SIZE) {
        const parent1 = tournamentSelect(population, 3);
        const parent2 = tournamentSelect(population, 3);
        const offspring = crossover(parent1, parent2);

        if (Math.random() < MUTATION_RATE) {
          mutate(offspring);
        }

        newPopulation.push(offspring);
      }

      population.length = 0;
      population.push(...newPopulation);
    }

    // Convert best solution to output format
    return convertSolutionToResult(bestSolution, units, cableSize, leftoverEntries, rollLength, meta, nextRollId);
  }

  function createRandomSolution(units, leftoverEntries, rollLength, cableSize, nextRollId) {
    // Random permutation of units
    const shuffled = [...units].sort(() => Math.random() - 0.5);
    return { assignment: shuffled, rollLength, cableSize };
  }

  function evaluateSolution(solution, tolerance, meta) {
    // Simulate packing with this order
    const rolls = [];
    let totalWaste = 0;
    let totalShortage = 0;
    let floorMixing = 0;

    solution.assignment.forEach((unit) => {
      let placed = false;

      for (const roll of rolls) {
        if (roll.remaining >= unit.length && roll.shortage === 0) {
          roll.remaining -= unit.length;
          roll.floors.add(unit.floor);
          placed = true;
          break;
        }
      }

      if (!placed) {
        rolls.push({
          remaining: solution.rollLength - unit.length,
          floors: new Set([unit.floor]),
          shortage: 0,
        });
      }
    });

    rolls.forEach((roll) => {
      totalWaste += roll.remaining;
      totalShortage += roll.shortage;
      floorMixing += roll.floors.size > 1 ? (roll.floors.size - 1) * 50 : 0;
    });

    return totalShortage * 10000 + totalWaste + floorMixing + rolls.length * 10;
  }

  function tournamentSelect(population, tournamentSize) {
    const tournament = [];
    for (let i = 0; i < tournamentSize; i++) {
      const idx = Math.floor(Math.random() * population.length);
      tournament.push(population[idx]);
    }
    tournament.sort((a, b) => a.fitness - b.fitness);
    return tournament[0];
  }

  function crossover(parent1, parent2) {
    const crossoverPoint = Math.floor(Math.random() * parent1.assignment.length);
    const offspring = {
      assignment: [
        ...parent1.assignment.slice(0, crossoverPoint),
        ...parent2.assignment.slice(crossoverPoint),
      ],
      rollLength: parent1.rollLength,
      cableSize: parent1.cableSize,
    };
    return offspring;
  }

  function mutate(individual) {
    const idx1 = Math.floor(Math.random() * individual.assignment.length);
    const idx2 = Math.floor(Math.random() * individual.assignment.length);
    const temp = individual.assignment[idx1];
    individual.assignment[idx1] = individual.assignment[idx2];
    individual.assignment[idx2] = temp;
  }

  function convertSolutionToResult(solution, units, cableSize, leftoverEntries, rollLength, meta, nextRollId) {
    const rolls = [];
    leftoverEntries.forEach((entry) => {
      rolls.push(createRoll(nextRollId('leftover'), cableSize, entry.length, 'leftover'));
    });

    solution.assignment.forEach((unit) => {
      let placed = false;

      for (const roll of rolls) {
        if (roll.shortage === 0 && roll.remaining >= unit.length) {
          commitUnit(roll, unit, 0, meta);
          placed = true;
          break;
        }
      }

      if (!placed) {
        const newRoll = createRoll(nextRollId('new'), cableSize, rollLength, 'new');
        rolls.push(newRoll);
        commitUnit(newRoll, unit, 0, meta);
      }
    });

    const usedRolls = rolls
      .filter((roll) => roll.assignments.length > 0)
      .map((roll) => ({
        id: roll.id,
        cableSize: roll.cableSize,
        source: roll.source,
        capacity: roll.capacity,
        remaining: Math.max(0, roll.remaining),
        shortage: roll.shortage,
        assignments: roll.assignments.map((assignment) => ({ ...assignment })),
        floors: Array.from(roll.floors),
        totalRequested: roll.totalRequested,
        totalActual: roll.totalActual,
      }));

    const stats = {
      cableSize,
      unitsCount: units.length,
      rolls: usedRolls.length,
      newRolls: usedRolls.filter((roll) => roll.source === 'new').length,
      leftoverRollsUsed: usedRolls.filter((roll) => roll.source === 'leftover').length,
      totalLeftover: usedRolls.reduce((sum, roll) => sum + roll.remaining, 0),
      totalShortage: usedRolls.reduce((sum, roll) => sum + roll.shortage, 0),
      totalActual: usedRolls.reduce((sum, roll) => sum + roll.totalActual, 0),
      totalRequired: units.reduce((sum, unit) => sum + unit.length, 0),
    };

    return { rolls: usedRolls, stats };
  }

  initializeFileInputUI();

  if (fileInput) {
    fileInput.addEventListener('change', handleFileLoad);
  }
  if (leftoverForm) {
    leftoverForm.addEventListener('submit', handleLeftoverSubmit);
  }
  if (leftoverTableBody) {
    leftoverTableBody.addEventListener('click', handleLeftoverClick);
  }
  if (optimizeButton) {
    optimizeButton.addEventListener('click', handleOptimize);
  }
  if (exportButton) {
    exportButton.addEventListener('click', handleExport);
  }
  if (printResultsButton) {
    printResultsButton.addEventListener('click', handlePrintResults);
  }

  function handlePrintResults() {
    if (!state.assignments.length) {
      setStatus('Run the optimization before printing.', 'warning');
      return;
    }
    window.print();
  }

  renderLeftovers();
})();
