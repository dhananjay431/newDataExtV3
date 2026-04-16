const pdfPath = "raj_PDF3.pdf";
const jsonPath1 = "content-understanding.json";
const scale = 1.5;
const pointsPerInch = 72;

function calculatePDI(pageInfo) {
  return {
    widthPoints: pageInfo.width * pointsPerInch,
    heightPoints: pageInfo.height * pointsPerInch,
    widthPixels: pageInfo.width * pointsPerInch * scale,
    heightPixels: pageInfo.height * pointsPerInch * scale,
  };
}

let pdfDoc = null;
let jsonData = null;
let fields = [];
let overlays = {};
let pageDimensions = {};
let activeLeaderLine = null;
let tooltipHideTimeout = null;
let tooltipNode = null;

window.addEventListener("resize", () => {
  if (activeLeaderLine) {
    activeLeaderLine.position();
  }
});

document.addEventListener("scroll", () => {
  if (activeLeaderLine) {
    activeLeaderLine.position();
  }
}, true);

async function loadData() {
  try {
    const [jsonResponse, pdfResponse] = await Promise.all([
      fetch(jsonPath1),
      fetch(pdfPath),
    ]);

    jsonData = await jsonResponse.json();
    const contents = jsonData.result.contents[0];
    document.getElementById("markdown-content").innerHTML =
      contents.markdown || "";

    pageDimensions = (contents.pages || []).reduce((acc, page) => {
      acc[page.pageNumber] = page;
      return acc;
    }, {});

    const pdfArrayBuffer = await pdfResponse.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: pdfArrayBuffer }).promise;

    parseFields();
    await renderPDF();
    populateSidebar();
  } catch (error) {
    console.error("Error loading data:", error);
  }
}

function parseFields() {
  const contents = jsonData.result.contents[0];
  const allFields = contents.fields;

  function flattenFields(obj, prefix = "") {
    for (const key in obj) {
      if (obj[key] && typeof obj[key] === "object") {
        if (obj[key].source) {
          fields.push({
            key: prefix + key,
            ...obj[key],
            sourceData: parseSourceData(obj[key].source),
          });
        } else if (obj[key].valueArray) {
          obj[key].valueArray.forEach((item, index) => {
            if (item.valueObject) {
              flattenFields(item.valueObject, `${prefix}${key}[${index}].`);
            }
          });
        } else if (obj[key].valueObject) {
          flattenFields(obj[key].valueObject, `${prefix}${key}.`);
        } else {
          flattenFields(obj[key], `${prefix}${key}.`);
        }
      }
    }
  }

  flattenFields(allFields);
}

async function renderPDF() {
  const container = document.getElementById("pdf-container");
  container.innerHTML = "";
  overlays = {};

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const pageDiv = document.createElement("div");
    pageDiv.className = "pdf-page";
    pageDiv.id = `page-${pageNum}`;

    const canvas = document.createElement("canvas");
    canvas.className = "pdf-canvas";
    canvas.id = `canvas-${pageNum}`;
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.style.width = `${viewport.width}px`;
    overlay.style.height = `${viewport.height}px`;

    pageDiv.appendChild(canvas);
    pageDiv.appendChild(overlay);
    container.appendChild(pageDiv);

    overlays[pageNum] = overlay;
  }

  addBoundingBoxes();
}

function addBoundingBoxes() {
  console.log(fields);
  fields.forEach((field) => {
    if (!field.sourceData) return;

    const { page, x, y, width, height } = field.sourceData;
    const overlay = overlays[page];
    let a = field.sourceData.points.map((d) => d * 108);
    console.log(a);
    if (!overlay) return;

    const box = document.createElement("div");
    box.className = "bounding-box";
    box.id = `box-${field.key}`;
    box.style.left = `${a[0]}px`;
    box.style.top = `${a[1]}px`;
    box.style.width = `${a[2] - a[0]}px`;
    box.style.height = `${a[5] - a[3]}px`;

    if (field.confidence < 0.5) {
      box.classList.add("confidence-low");
    } else if (field.confidence < 0.8) {
      box.classList.add("confidence-medium");
    } else {
      box.classList.add("confidence-high");
    }

    box.addEventListener("mouseenter", () => handleHover(field.key));
    box.addEventListener("mouseleave", () => handleUnhover(field.key));

    overlay.appendChild(box);
  });
}

function parseSourceData(sourceStr) {
  const match = sourceStr.match(
    /D\((\d+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/,
  );
  if (!match) return null;

  const page = parseInt(match[1], 10);
  const coords = match.slice(2).map(parseFloat);
  const xs = [coords[0], coords[2], coords[4], coords[6]];
  const ys = [coords[1], coords[3], coords[5], coords[7]];
  const pageInfo = pageDimensions[page] || { width: 8.5, height: 11 };
  const pdi = calculatePDI(pageInfo);
  const pageHeightPoints = pdi.heightPoints;

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  const x = xMin * pointsPerInch * scale;
  const y = (pageHeightPoints - yMax * pointsPerInch) * scale;
  const width = (xMax - xMin) * pointsPerInch * scale;
  const height = (yMax - yMin) * pointsPerInch * scale;

  return {
    page,
    x,
    y,
    width,
    height,
    points: coords,
    pageInfo,
  };
}

function populateSidebar() {
  const fieldsList = document.getElementById("fields-list");
  fieldsList.innerHTML = "";

  const groups = {};
  fields.forEach((field) => {
    const category = field.key.split(".")[0];
    if (!groups[category]) groups[category] = [];
    groups[category].push(field);
  });

  for (const category in groups) {
    const groupDiv = document.createElement("div");
    groupDiv.className = "field-group";

    const title = document.createElement("h3");
    title.textContent = category;
    groupDiv.appendChild(title);

    groups[category].forEach((field) => {
      const item = document.createElement("div");
      item.className = "field-item";
      item.dataset.key = field.key;

      const label = document.createElement("div");
      label.className = "field-label";
      label.textContent = field.key.split(".").pop();

      const value = document.createElement("div");
      value.className = "field-value";
      value.textContent = field.valueString || field.valueNumber || "N/A";

      item.appendChild(label);
      item.appendChild(value);
      item.addEventListener("click", () => highlightField(field.key));
      item.addEventListener("mouseenter", () => handleHover(field.key));
      item.addEventListener("mouseleave", () => handleUnhover(field.key));
      groupDiv.appendChild(item);
    });

    fieldsList.appendChild(groupDiv);
  }
}

function highlightField(key) {
  document.querySelectorAll(".bounding-box.highlighted").forEach((box) => {
    box.classList.remove("highlighted");
  });
  document.querySelectorAll(".field-item.selected").forEach((item) => {
    item.classList.remove("selected");
  });

  const box = document.getElementById(`box-${key}`);
  if (box) {
    box.classList.add("highlighted");
    const pageNum = box.closest(".pdf-page").id.split("-")[1];
    document
      .getElementById(`page-${pageNum}`)
      .scrollIntoView({ behavior: "smooth" });
  }

  const item = document.querySelector(`[data-key="${key}"]`);
  if (item) item.classList.add("selected");
}

function handleHover(key) {
  clearTimeout(tooltipHideTimeout);
  const box = document.getElementById(`box-${key}`);
  const item = document.querySelector(`[data-key="${key}"]`);
  
  if (box) box.classList.add("hovered");
  if (item) item.classList.add("hovered");
  
  if (box && item) {
    item.scrollIntoView({ behavior: "smooth", block: "nearest" });
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    createHoverLeaderLine(item, box);
  }

  showTooltip(key, box);
}

function handleUnhover(key) {
  const box = document.getElementById(`box-${key}`);
  const item = document.querySelector(`[data-key="${key}"]`);
  
  if (box) box.classList.remove("hovered");
  if (item) item.classList.remove("hovered");
  
  removeHoverLeaderLine();
  
  tooltipHideTimeout = setTimeout(() => {
    hideTooltip();
  }, 200);
}

function createHoverLeaderLine(startElement, endElement) {
  removeHoverLeaderLine();
  if (!window.LeaderLine || !startElement || !endElement) return;

  activeLeaderLine = new LeaderLine(startElement, endElement, {
    path: "fluid",
    startSocket: "right",
    endSocket: "left",
    color: "#00aaff",
    size: 2,
    dash: { animation: true },
    gradient: true,
    startPlug: "disc",
    endPlug: "arrow1",
  });
}

function removeHoverLeaderLine() {
  if (activeLeaderLine) {
    activeLeaderLine.remove();
    activeLeaderLine = null;
  }
}

function showTooltip(key, boxElement) {
  if (!boxElement) return;

  const field = fields.find(f => f.key === key);
  if (!field) return;

  const value = field.valueString || field.valueNumber || "N/A";

  if (!tooltipNode) {
    tooltipNode = document.createElement("div");
    tooltipNode.className = "bounding-box-tooltip";
    
    tooltipNode.addEventListener("mouseenter", () => {
      clearTimeout(tooltipHideTimeout);
    });
    tooltipNode.addEventListener("mouseleave", () => {
      tooltipHideTimeout = setTimeout(() => {
        hideTooltip();
      }, 200);
    });
  }

  tooltipNode.innerHTML = `
    <div class="tooltip-key">${field.key.split('.').pop()}</div>
    <textarea class="tooltip-value-box">${value}</textarea>
    <div class="tooltip-actions">
      <button class="tooltip-save-btn">Save</button>
    </div>
  `;

  const textbox = tooltipNode.querySelector('.tooltip-value-box');
  const saveBtn = tooltipNode.querySelector('.tooltip-save-btn');
  
  saveBtn.addEventListener('click', () => {
    // Update internal data
    field.valueString = textbox.value;
    
    // Update sidebar UI
    const item = document.querySelector(`[data-key="${key}"]`);
    if (item) {
      const valueEl = item.querySelector('.field-value');
      if (valueEl) valueEl.textContent = textbox.value;
    }
    
    // UI Feedback
    saveBtn.textContent = "Saved!";
    saveBtn.style.backgroundColor = "#28a745";
    
    setTimeout(() => {
      hideTooltip();
      saveBtn.textContent = "Save";
      saveBtn.style.backgroundColor = "";
    }, 600);
  });

  tooltipNode.classList.add("visible");
  
  const pageOverlay = boxElement.closest('.pdf-page').querySelector('.overlay');
  if (tooltipNode.parentElement !== pageOverlay) {
    pageOverlay.appendChild(tooltipNode);
  }
  
  const left = parseFloat(boxElement.style.left) + parseFloat(boxElement.style.width) / 2;
  const top = parseFloat(boxElement.style.top);

  tooltipNode.style.left = `${left}px`;
  tooltipNode.style.top = `${top - 8}px`;
  tooltipNode.style.transform = "translate(-50%, -100%)";
}

function hideTooltip() {
  if (tooltipNode) {
    tooltipNode.classList.remove("visible");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadData();
  
  const toggleChecksBtn = document.getElementById("toggle-checks-btn");
  if (toggleChecksBtn) {
    toggleChecksBtn.addEventListener("click", () => {
      const container = document.getElementById("pdf-container");
      container.classList.toggle("show-checks");
      
      if (container.classList.contains("show-checks")) {
        toggleChecksBtn.textContent = "Hide Checkmarks";
      } else {
        toggleChecksBtn.textContent = "Show Checkmarks";
      }
    });
  }
});
