import React, { useState, useEffect, useRef } from 'react';
import { Layers, Loader2, ChevronDown, ChevronRight, FileCode } from 'lucide-react';
import * as d3 from 'd3';

export function ArchitecturePanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{ nodes: any[], links: any[] } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/tools/analyze_dependencies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId })
        });
        const json = await res.json();
        setData(json);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [projectId]);

  return (
    <div className="h-full flex flex-col bg-mimo-bg overflow-hidden text-mimo-text">
       <header className="px-6 h-12 border-b border-mimo-border bg-mimo-panel flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
             <Layers className="w-3.5 h-3.5 text-mimo-accent" />
             <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-mimo-text-muted">Architecture Graph</span>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="text-[9px] font-mono text-mimo-accent uppercase hover:underline"
          >
            Refresh
          </button>
       </header>
       <div className="flex-1 relative bg-black/20">
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-mimo-accent" />
            </div>
          ) : data ? (
            <DependencyGraph data={data} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-mimo-text-muted font-mono text-xs">
              Failed to load mapping data.
            </div>
          )}
          
          <div className="absolute bottom-4 left-4 p-3 bg-mimo-panel/80 backdrop-blur rounded border border-mimo-border text-[9px] font-mono space-y-1">
             <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-mimo-accent" />
                <span>INTERNAL MODULES</span>
             </div>
             <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span>EXTERNAL PACKAGES</span>
             </div>
          </div>
       </div>
    </div>
  );
}

function DependencyGraph({ data }: { data: { nodes: any[], links: any[] } }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !data) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height]);

    const g = svg.append("g");

    svg.call(d3.zoom<SVGSVGElement, unknown>()
      .extent([[0, 0], [width, height]])
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      }));

    const simulation = d3.forceSimulation(data.nodes)
      .force("link", d3.forceLink(data.links).id((d: any) => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(50));

    const link = g.append("g")
      .attr("stroke", "#444")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(data.links)
      .join("line")
      .attr("stroke-width", 1);

    const node = g.append("g")
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.5)
      .selectAll("g")
      .data(data.nodes)
      .join("g")
      .call(d3.drag<any, any>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

    node.append("circle")
      .attr("r", 6)
      .attr("fill", (d: any) => (d.id.includes('/') || d.id.startsWith('.')) ? "var(--color-mimo-accent)" : "#3b82f6");

    node.append("text")
      .text((d: any) => d.id.split('/').pop())
      .attr("x", 8)
      .attr("y", 4)
      .attr("fill", "#fff")
      .attr("font-size", "8px")
      .attr("font-family", "monospace")
      .style("pointer-events", "none")
      .style("text-shadow", "0 0 4px #000");

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => simulation.stop();
  }, [data]);

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden cursor-move">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
