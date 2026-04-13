// script.js
const pdfPath = "raj_PDF3.pdf";
const jsonPath1 = "content-understanding.json";
const scale = 1.5;
const dpi = 96;

let pdfDoc = null;
let jsonData = null;
let currentPage = 1;
let fields = [];
let overlays = {};

async function loadData() {
  try {
    // Load JSON
    const jsonResponse = await fetch(jsonPath1);
    jsonData = await jsonResponse.json();

    // Load PDF
    const pdfResponse = await fetch(pdfPath);
    const pdfArrayBuffer = await pdfResponse.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: pdfArrayBuffer }).promise;

    // Parse fields
    parseFields();

    // Render PDF
    renderPDF();

    // Populate sidebar
    populateSidebar();
  } catch (error) {
    console.error("Error loading data:", error);
  }
}

function parseFields() {
  const contents = jsonData.result.contents[0];
  const allFields = contents.fields;

  // Flatten fields including nested ones
  function flattenFields(obj, prefix = "") {
    for (const key in obj) {
      if (obj[key] && typeof obj[key] === "object") {
        if (obj[key].source) {
          fields.push({
            key: prefix + key,
            ...obj[key],
          });
        } else if (obj[key].valueArray) {
          obj[key].valueArray.forEach((item, index) => {
            if (item.valueObject) {
              flattenFields(item.valueObject, `${prefix}${key}[${index}].`);
            }
          });
        } else if (obj[key].valueObject) {
          flattenFields(obj[key].valueObject, `${prefix}${key}.`);
        }
      }
    }
  }

  flattenFields(allFields);
}

async function renderPDF() {
  const container = document.getElementById("pdf-container");
  container.innerHTML = "";

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });

    const pageDiv = document.createElement("div");
    pageDiv.className = "pdf-page";
    pageDiv.id = `page-${pageNum}`;

    const canvas = document.createElement("canvas");
    canvas.className = "pdf-canvas";
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const context = canvas.getContext("2d");
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };

    await page.render(renderContext).promise;

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.style.width = viewport.width + "px";
    overlay.style.height = viewport.height + "px";

    pageDiv.appendChild(canvas);
    pageDiv.appendChild(overlay);
    container.appendChild(pageDiv);

    overlays[pageNum] = overlay;
  }

  // Add bounding boxes
  addBoundingBoxes();
}

function addBoundingBoxes() {
  fields.forEach((field) => {
    if (field.source) {
      const source = parseSource(field.source);
      if (source) {
        const overlay = overlays[source.page];
        if (overlay) {
          const box = document.createElement("div");
          box.className = "bounding-box";
          box.id = `box-${field.key}`;
          box.style.left = source.x + "px";
          box.style.top = source.y + "px";
          box.style.width = source.width + "px";
          box.style.height = source.height + "px";

          // Set confidence class
          if (field.confidence < 0.5) {
            box.classList.add("confidence-low");
          } else if (field.confidence < 0.8) {
            box.classList.add("confidence-medium");
          } else {
            box.classList.add("confidence-high");
          }

          overlay.appendChild(box);
        }
      }
    }
  });
}

function parseSource(sourceStr) {
  // D(page,x1,y1,x2,y2,x3,y3,x4,y4)
  const match = sourceStr.match(
    /D\((\d+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/,
  );
  if (match) {
    const page = parseInt(match[1]);
    const points = match.slice(2).map(parseFloat);
    // Assume rectangle for simplicity, calculate min/max
    const xs = [points[0], points[2], points[4], points[6]];
    const ys = [points[1], points[3], points[5], points[7]];
    const x = Math.min(...xs) * dpi * scale;
    const y = Math.min(...ys) * dpi * scale;
    const width = (Math.max(...xs) - Math.min(...xs)) * dpi * scale;
    const height = (Math.max(...ys) - Math.min(...ys)) * dpi * scale;
    return { page, x, y, width, height };
  }
  return null;
}

function populateSidebar() {
  const fieldsList = document.getElementById("fields-list");

  // Group fields by type or category
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

      groupDiv.appendChild(item);
    });

    fieldsList.appendChild(groupDiv);
  }
}

function highlightField(key) {
  // Remove previous highlights
  document.querySelectorAll(".bounding-box.highlighted").forEach((box) => {
    box.classList.remove("highlighted");
  });
  document.querySelectorAll(".field-item.selected").forEach((item) => {
    item.classList.remove("selected");
  });

  // Highlight box
  const box = document.getElementById(`box-${key}`);
  if (box) {
    box.classList.add("highlighted");
    // Scroll to page
    const pageNum = box.closest(".pdf-page").id.split("-")[1];
    document.getElementById(`page-${pageNum}`).scrollIntoView();
  }

  // Highlight field item
  const item = document.querySelector(`[data-key="${key}"]`);
  if (item) {
    item.classList.add("selected");
  }
}

// Initialize
loadData();
document.addEventListener("DOMContentLoaded", function () {
  fetch("content-understanding.json")
    .then((response) => response.json())
    .then((data) => processData(data))
    .catch((error) => console.error("Error loading JSON:", error));
});

function processData(data) {
  const contents = data.result.contents[0];
  const fields = contents.fields;
  const pages = contents.pages;

  // Group sources by page
  const sourcesByPage = {};

  function extractSources(obj, path = "") {
    if (typeof obj === "object" && obj !== null) {
      if (obj.source) {
        const sourceStr = obj.source;
        const match = sourceStr.match(/^D\((\d+),(.+)\)$/);
        if (match) {
          const page = parseInt(match[1]);
          const coords = match[2].split(",").map(parseFloat);
          if (!sourcesByPage[page]) sourcesByPage[page] = [];
          sourcesByPage[page].push({
            path: path,
            coords: coords,
            value: obj.valueString || obj.valueNumber || obj.valueDate || "N/A",
          });
        }
      }
      for (const key in obj) {
        extractSources(obj[key], path ? `${path}.${key}` : key);
      }
    }
  }

  extractSources(fields);

  // Generate SVGs for pages
  const pagesContainer = document.getElementById("pages-container");
  pages.forEach((page) => {
    const pageDiv = document.createElement("div");
    pageDiv.className = "page";
    pageDiv.innerHTML = `<h3>Page ${page.pageNumber}</h3>`;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${page.width} ${page.height}`);
    svg.style.width = "100%";
    svg.style.height = "auto";

    // Background
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("width", page.width);
    rect.setAttribute("height", page.height);
    rect.setAttribute("fill", "white");
    rect.setAttribute("stroke", "black");
    rect.setAttribute("stroke-width", "0.01");
    svg.appendChild(rect);

    // Add polygons
    if (sourcesByPage[page.pageNumber]) {
      sourcesByPage[page.pageNumber].forEach((item) => {
        const polygon = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "polygon",
        );
        const points = item.coords
          .map((c, i) => (i % 2 === 0 ? c : page.height - c))
          .join(" ");
        polygon.setAttribute("points", points);
        polygon.setAttribute("fill", "none");
        polygon.setAttribute("stroke", "red");
        polygon.setAttribute("stroke-width", "0.01");
        svg.appendChild(polygon);

        // Label
        const text = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text",
        );
        text.setAttribute("x", item.coords[0]);
        text.setAttribute("y", page.height - item.coords[1] - 0.1);
        text.setAttribute("font-size", "0.1");
        text.setAttribute("fill", "blue");
        text.textContent = item.path.split(".").pop();
        svg.appendChild(text);
      });
    }

    pageDiv.appendChild(svg);
    pagesContainer.appendChild(pageDiv);
  });

  // Display fields
  const fieldsContainer = document.getElementById("fields-container");
  function displayFields(obj, container, prefix = "") {
    for (const key in obj) {
      if (key === "source" || key === "spans" || key === "confidence") continue;
      const value = obj[key];
      if (typeof value === "object" && value !== null) {
        if (value.type && value.valueString !== undefined) {
          const div = document.createElement("div");
          div.className = "field-item";
          div.innerHTML = `<div class="field-key">${prefix}${key}:</div><div class="field-value">${value.valueString || value.valueNumber || value.valueDate || "N/A"}</div>`;
          container.appendChild(div);
        } else if (Array.isArray(value)) {
          value.forEach((item, index) => {
            displayFields(item, container, `${prefix}${key}[${index}].`);
          });
        } else {
          displayFields(value, container, `${prefix}${key}.`);
        }
      } else {
        const div = document.createElement("div");
        div.className = "field-item";
        div.innerHTML = `<div class="field-key">${prefix}${key}:</div><div class="field-value">${value}</div>`;
        container.appendChild(div);
      }
    }
  }
  displayFields(fields, fieldsContainer);
}
const jsonPath = "content-understanding.json";
const svgContainer = document.getElementById("svg-canvas");
const list = document.getElementById("field-list");
const status = document.getElementById("status");
let draw = null;
let regions = [];
let selectedRegionId = null;
let hoveredRegionId = null;

function initCanvas() {
  draw = SVG().addTo(svgContainer).size("612px", "792px");
}

function parseSource(source) {
  if (typeof source !== "string") {
    return null;
  }
  const match = source.match(/^D\(([^)]+)\)$/);
  if (!match) {
    return null;
  }
  const numbers = match[1]
    .split(",")
    .map((value) => parseFloat(value.trim()))
    .filter((value) => !Number.isNaN(value));
  if (numbers.length < 3) {
    return null;
  }
  const pageNumber = numbers[0];
  const coordinates = numbers.slice(1);
  if (coordinates.length % 2 !== 0) {
    return null;
  }
  const points = [];
  for (let i = 0; i < coordinates.length; i += 2) {
    points.push({ x: coordinates[i], y: coordinates[i + 1] });
  }
  return { pageNumber, points };
}

function getPreviewText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "boolean") return String(node);
  if (node.valueString) return node.valueString;
  if (node.valueNumber !== undefined) return String(node.valueNumber);
  if (node.type) return node.type;
  return JSON.stringify(node).slice(0, 50);
}

function walkNode(node, path = []) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walkNode(item, path.concat(`[${index}]`)));
    return;
  }
  if (node && typeof node === "object") {
    if (node.source) {
      const parsed = parseSource(node.source);
      if (parsed) {
        regions.push({
          id: `region-${regions.length + 1}`,
          path: path.length ? path.join(".") : "root",
          preview: getPreviewText(node),
          source: node.source,
          parsed,
          svgElement: null,
          listElement: null,
        });
      }
    }
    Object.entries(node).forEach(([key, value]) => {
      if (key === "source") return;
      walkNode(value, path.concat(key));
    });
  }
}

function updateRegionStates() {
  regions.forEach((region) => {
    const selected = selectedRegionId === region.id;
    const hovered = hoveredRegionId === region.id;
    if (region.svgElement) {
      if (selected) {
        region.svgElement.addClass("active");
      } else {
        region.svgElement.removeClass("active");
      }
      if (hovered && !selected) {
        region.svgElement.addClass("hovered");
      } else {
        region.svgElement.removeClass("hovered");
      }
    }
    region.listElement.classList.toggle("active", selected);
    region.listElement.classList.toggle("hovered", hovered && !selected);
  });
}

function setSelectedRegion(regionId) {
  selectedRegionId = selectedRegionId === regionId ? null : regionId;
  updateRegionStates();
  const region = regions.find((item) => item.id === selectedRegionId);
  status.textContent = region
    ? `Selected region: ${region.path} — ${region.preview}`
    : `Click a region list item or an SVG highlight to see details.`;
}

function setHoveredRegion(regionId) {
  hoveredRegionId = regionId;
  updateRegionStates();
}

function buildSVG() {
  const allPoints = regions.flatMap((region) => region.parsed.points);
  if (!allPoints.length) {
    draw?.clear();
    return;
  }

  if (!draw) {
    initCanvas();
  }

  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const padding = Math.max(maxX - minX, maxY - minY) * 0.05 + 0.5;
  const width = maxX - minX + padding * 2;
  const height = maxY - minY + padding * 2;

  draw.clear();
  draw.viewbox(minX - padding, minY - padding, width, height);
  draw
    .rect(width, height)
    .move(minX - padding, minY - padding)
    .fill("#f8fafb");

  regions.forEach((region) => {
    const points = region.parsed.points.flatMap((point) => [point.x, point.y]);
    const polygon = draw
      .polygon(points)
      .fill("rgba(59, 130, 246, 0.18)")
      .stroke({ color: "rgba(37, 99, 235, 0.9)", width: 0.08 })
      .addClass("region");

    polygon.on("mouseenter", () => setHoveredRegion(region.id));
    polygon.on("mouseleave", () => setHoveredRegion(null));
    polygon.on("click", () => setSelectedRegion(region.id));
    region.svgElement = polygon;

    if (region.parsed.points.length > 0) {
      const first = region.parsed.points[0];
      draw
        .text(region.id)
        .font({ size: 10, family: "system-ui, sans-serif" })
        .move(first.x + 0.05, first.y - 0.1)
        .addClass("region-label");
    }
  });
}

function renderFieldList() {
  if (!regions.length) {
    list.innerHTML =
      "<p>No <code>source</code> entries were found in the JSON.</p>";
    return;
  }
  list.innerHTML = "";

  regions.forEach((region) => {
    const item = document.createElement("button");
    item.className = "field-item";
    item.type = "button";
    item.innerHTML = `
      <span class="label">${region.path}</span>
      <span>${region.preview}</span>
      <span class="source">${region.source}</span>
    `;
    item.addEventListener("click", () => setSelectedRegion(region.id));
    item.addEventListener("mouseenter", () => setHoveredRegion(region.id));
    item.addEventListener("mouseleave", () => setHoveredRegion(null));
    region.listElement = item;
    list.appendChild(item);
  });
}

function showStatus(message) {
  status.textContent = message;
}

function loadJson() {
  fetch(jsonPath)
    .then((response) => {
      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${jsonPath}: ${response.status} ${response.statusText}`,
        );
      }
      return response.json();
    })
    .then((json) => {
      const contents = json?.result?.contents;
      if (!Array.isArray(contents) || !contents.length) {
        showStatus("No JSON contents were found in the document.");
        return;
      }
      walkNode(contents[0]);
      buildSVG();
      renderFieldList();
      showStatus(
        `Loaded ${regions.length} source region${regions.length === 1 ? "" : "s"}. Click any item to highlight it.`,
      );
    })
    .catch((error) => {
      showStatus(`Error loading JSON: ${error.message}`);
      list.innerHTML = "";
    });
}

loadJson();
