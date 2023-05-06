import React, { useEffect, useState, useMemo, forwardRef, useImperativeHandle, useRef, MutableRefObject } from 'react';
import embed from 'vega-embed';
import { Subject, Subscription, firstValueFrom } from 'rxjs'
import * as op from 'rxjs/operators';
import type { ScenegraphEvent, View } from 'vega';
import styled from 'styled-components';

import { IViewField, IRow, IStackMode, IDarkMode, IThemeKey } from '../interfaces';
import { useTranslation } from 'react-i18next';
import { getVegaTimeFormatRules } from './temporalFormat';
import { builtInThemes } from './theme';
import { useCurrentMediaTheme } from '../utils/media';
import { SingleViewProps, getSingleView } from './spec/view';
import { NULL_FIELD } from './spec/field';

const CanvaContainer = styled.div<{rowSize: number; colSize: number;}>`
  display: grid;
  grid-template-columns: repeat(${props => props.colSize}, 1fr);
  grid-template-rows: repeat(${props => props.rowSize}, 1fr);
`

const SELECTION_NAME = 'geom';
export interface IReactVegaHandler {
  setUnready: () => any;
  setReady: () => any;
  ready: () => Promise<boolean>;
  getSVGData: () => Promise<string[]>;
  getCanvasData: () => Promise<string[]>;
  downloadSVG: (filename?: string) => Promise<string[]>;
  downloadPNG: (filename?: string) => Promise<string[]>;
}
interface ReactVegaProps {
  rows: Readonly<IViewField[]>;
  columns: Readonly<IViewField[]>;
  dataSource: IRow[];
  defaultAggregate?: boolean;
  stack: IStackMode;
  interactiveScale: boolean;
  geomType: string;
  color?: IViewField;
  opacity?: IViewField;
  size?: IViewField;
  shape?: IViewField;
  theta?: IViewField;
  radius?: IViewField;
  details?: Readonly<IViewField[]>;
  showActions: boolean;
  layoutMode: string;
  width: number;
  height: number;
  onGeomClick?: (values: any, e: any) => void
  /** @default "vega" */
  themeKey?: IThemeKey;
  dark?: IDarkMode;
  loading?: boolean;
}

const click$ = new Subject<ScenegraphEvent>();
const selection$ = new Subject<any>();
const geomClick$ = selection$.pipe(
  op.withLatestFrom(click$),
  op.filter(([values, _]) => {
    if (Object.keys(values).length > 0) {
      return true
    }
    return false
  })
);

const BRUSH_SIGNAL_NAME = "__gw_brush__";
const POINT_SIGNAL_NAME = "__gw_point__";

interface ParamStoreEntry {
  signal: typeof BRUSH_SIGNAL_NAME | typeof POINT_SIGNAL_NAME;
  /** 这个标记用于防止循环 */
  source: number;
  data: any;
}


const ReactVega = forwardRef<IReactVegaHandler, ReactVegaProps>(function ReactVega (props, ref) {
  const {
    dataSource = [],
    rows = [],
    columns = [],
    defaultAggregate = true,
    stack = 'stack',
    geomType,
    color,
    opacity,
    size,
    theta,
    radius,
    shape,
    onGeomClick,
    showActions,
    interactiveScale,
    layoutMode,
    width,
    height,
    details = [],
    themeKey = 'vega',
    dark = 'media',
    loading = false,
  } = props;
  const [viewPlaceholders, setViewPlaceholders] = useState<React.MutableRefObject<HTMLDivElement>[]>([]);
  const { i18n } = useTranslation();
  const mediaTheme = useCurrentMediaTheme(dark);
  const themeConfig = builtInThemes[themeKey]?.[mediaTheme];
  useEffect(() => {
    const clickSub = geomClick$.subscribe(([values, e]) => {
      if (onGeomClick) {
        onGeomClick(values, e);
      }
    })
    return () => {
      clickSub.unsubscribe();
    }
  }, [onGeomClick]);
  const rowDims = useMemo(() => rows.filter(f => f.analyticType === 'dimension'), [rows]);
  const colDims = useMemo(() => columns.filter(f => f.analyticType === 'dimension'), [columns]);
  const rowMeas = useMemo(() => rows.filter(f => f.analyticType === 'measure'), [rows]);
  const colMeas = useMemo(() => columns.filter(f => f.analyticType === 'measure'), [columns]);
  const rowFacetFields = useMemo(() => rowDims.slice(0, -1), [rowDims]);
  const colFacetFields = useMemo(() => colDims.slice(0, -1), [colDims]);
  const rowRepeatFields = useMemo(() => rowMeas.length === 0 ? rowDims.slice(-1) : rowMeas, [rowDims, rowMeas]);//rowMeas.slice(0, -1);
  const colRepeatFields = useMemo(() => colMeas.length === 0 ? colDims.slice(-1) : colMeas, [rowDims, rowMeas]);//colMeas.slice(0, -1);
  const allFieldIds = useMemo(() => [...rows, ...columns, color, opacity, size].filter(f => Boolean(f)).map(f => (f as IViewField).fid), [rows, columns, color, opacity, size]);

  const [crossFilterTriggerIdx, setCrossFilterTriggerIdx] = useState(-1);

  useEffect(() => {
    setCrossFilterTriggerIdx(-1);
    setViewPlaceholders(views => {
      const viewNum = Math.max(1, rowRepeatFields.length * colRepeatFields.length)
      const nextViews = new Array(viewNum).fill(null).map((v, i) => views[i] || React.createRef())
      return nextViews;
    })
  }, [rowRepeatFields, colRepeatFields])

  const vegaRefs = useRef<View[]>([]);
  const ready$ = useRef<Subject<boolean>>(new Subject<boolean>());

  useEffect(() => {
    vegaRefs.current = [];

    const yField = rows.length > 0 ? rows[rows.length - 1] : NULL_FIELD;
    const xField = columns.length > 0 ? columns[columns.length - 1] : NULL_FIELD;

    const rowLeftFacetFields = rows.slice(0, -1).filter(f => f.analyticType === 'dimension');
    const colLeftFacetFields = columns.slice(0, -1).filter(f => f.analyticType === 'dimension');

    const rowFacetField = rowLeftFacetFields.length > 0 ? rowLeftFacetFields[rowLeftFacetFields.length - 1] : NULL_FIELD;
    const colFacetField = colLeftFacetFields.length > 0 ? colLeftFacetFields[colLeftFacetFields.length - 1] : NULL_FIELD;

    const spec: any = {
      data: {
        values: dataSource,
      },
      params: [{
        name: SELECTION_NAME,
        select: {
          type: 'point',
          fields: allFieldIds
        }
      }]
    };
    if (interactiveScale) {
      spec.params.push({
        name: "grid",
        select: "interval",
        bind: "scales"
      })
    }
    if (rowRepeatFields.length <= 1 && colRepeatFields.length <= 1) {
      if (layoutMode === 'fixed') {
        if (rowFacetField === NULL_FIELD && colFacetField === NULL_FIELD) {
          spec.autosize = 'fit'
        }
        spec.width = width;
        spec.height = height;
      }
      const singleView = getSingleView({
        x: xField,
        y: yField,
        color: color ? color : NULL_FIELD,
        opacity: opacity ? opacity : NULL_FIELD,
        size: size ? size : NULL_FIELD,
        shape: shape ? shape : NULL_FIELD,
        theta: theta ? theta : NULL_FIELD,
        radius: radius ? radius : NULL_FIELD,
        row: rowFacetField,
        column: colFacetField,
        xOffset: NULL_FIELD,
        yOffset: NULL_FIELD,
        details,
        defaultAggregated: defaultAggregate,
        stack,
        geomType,
      });

      spec.mark = singleView.mark;
      if ('encoding' in singleView) {
        spec.encoding = singleView.encoding;
      }

      if (viewPlaceholders.length > 0 && viewPlaceholders[0].current) {
        embed(viewPlaceholders[0].current, spec, { mode: 'vega-lite', actions: showActions, timeFormatLocale: getVegaTimeFormatRules(i18n.language), config: themeConfig }).then(res => {
          console.log("ready next");
          ready$.current.next(true);
          try {
            res.view.addEventListener('click', (e) => {
              click$.next(e);
            })
            res.view.addSignalListener(SELECTION_NAME, (name: any, values: any) => {
              selection$.next(values);
            }); 
          } catch (error) {
            console.warn(error)
          }
        });
      }
    } else {
      if (layoutMode === 'fixed') {
        spec.width = Math.floor(width / colRepeatFields.length) - 5;
        spec.height = Math.floor(height / rowRepeatFields.length) - 5;
        spec.autosize = 'fit'
      }
      const combinedParamStore$ = new Subject<ParamStoreEntry>();
      const throttledParamStore$ = combinedParamStore$.pipe(
        op.throttleTime(
          dataSource.length / 64 * rowRepeatFields.length * colRepeatFields.length,
          undefined,
          { leading: false, trailing: true }
        )
      );
      const subscriptions: Subscription[] = [];
      const subscribe = (cb: (entry: ParamStoreEntry) => void) => {
        subscriptions.push(throttledParamStore$.subscribe(cb));
      };
      let index = 0;
      const viewPromises: Promise<any>[] = [], viewResolves: any[] = [];
      for (let i = 0; i < rowRepeatFields.length; i++) {
        for (let j = 0; j < colRepeatFields.length; j++, index++) {
          const sourceId = index;
          const hasLegend = i === 0 && j === colRepeatFields.length - 1;
          const singleView = getSingleView({
            x: colRepeatFields[j] || NULL_FIELD,
            y: rowRepeatFields[i] || NULL_FIELD,
            color: color ? color : NULL_FIELD,
            opacity: opacity ? opacity : NULL_FIELD,
            size: size ? size : NULL_FIELD,
            shape: shape ? shape : NULL_FIELD,
            theta: theta ? theta : NULL_FIELD,
            radius: radius ? radius : NULL_FIELD,
            row: rowFacetField,
            column: colFacetField,
            xOffset: NULL_FIELD,
            yOffset: NULL_FIELD,
            details,
            defaultAggregated: defaultAggregate,
            stack,
            geomType,
            hideLegend: !hasLegend,
          });
          const node = i * colRepeatFields.length + j < viewPlaceholders.length ? viewPlaceholders[i * colRepeatFields.length + j].current : null
          let commonSpec = { ...spec };

          const ans = { ...commonSpec, ...singleView }
          if ('params' in commonSpec) {
            ans.params = commonSpec.params;
          }
          if (node) {
            const idx = i * colRepeatFields.length + j;
            viewPromises[idx] = new Promise((resolve) => { viewResolves[idx] = resolve });
            embed(node, ans, { mode: 'vega-lite', actions: showActions, timeFormatLocale: getVegaTimeFormatRules(i18n.language), config: themeConfig }).then(res => {
              const paramStores = (res.vgSpec.data?.map(d => d.name) ?? []).filter(
                name => [BRUSH_SIGNAL_NAME, POINT_SIGNAL_NAME].map(p => `${p}_store`).includes(name)
              ).map(name => name.replace(/_store$/, ''));
              try {
                for (const param of paramStores) {
                  let noBroadcasting = false;
                  // 发出
                  res.view.addSignalListener(param, name => {
                    if (noBroadcasting) {
                      noBroadcasting = false;
                      return;
                    }
                    if ([BRUSH_SIGNAL_NAME, POINT_SIGNAL_NAME].includes(name)) {
                      const data = res.view.getState().data?.[`${name}_store`];
                      if (!data || (Array.isArray(data) && data.length === 0)) {
                        setCrossFilterTriggerIdx(-1);
                      }
                      combinedParamStore$.next({
                        signal: name as typeof BRUSH_SIGNAL_NAME | typeof POINT_SIGNAL_NAME,
                        source: sourceId,
                        data: data ?? null,
                      });
                    }
                  });
                  subscribe(entry => {
                    if (entry.source === sourceId || !entry.data) {
                      return;
                    }
                    noBroadcasting = true;
                    res.view.setState({
                      data: {
                        [`${entry.signal}_store`]: entry.data,
                      },
                    });
                  });
                }
              } catch (error) {
                console.warn('Crossing filter failed', error);
              }
              try {
                res.view.addEventListener('mouseover', () => {
                  if (sourceId !== crossFilterTriggerIdx) {
                    setCrossFilterTriggerIdx(sourceId);
                  }
                });
                res.view.addEventListener('click', (e) => {
                  click$.next(e);
                })
                res.view.addSignalListener(SELECTION_NAME, (name: any, values: any) => {
                  selection$.next(values);
                }); 
              } catch (error) {
                console.warn(error);
              }
              viewResolves[idx]();
              vegaRefs.current.push(res.view);
            })
          }
        }
      }
      Promise.all(viewPromises).then(() => {
        ready$.current.next(true);
      });
      return () => {
        subscriptions.forEach(sub => sub.unsubscribe());
      };
    }
  }, [
    dataSource,
    allFieldIds,
    rows,
    columns,
    defaultAggregate,
    geomType,
    color,
    opacity,
    size,
    shape,
    theta, radius,
    viewPlaceholders,
    rowFacetFields,
    colFacetFields,
    rowRepeatFields,
    colRepeatFields,
    stack,
    showActions,
    interactiveScale,
    layoutMode,
    width,
    height,
    themeConfig,
    details
  ]);

  type resolveLoadingHandler = (success: boolean) => void;
  const resolveLoadingRef: MutableRefObject<resolveLoadingHandler[]> = useRef<resolveLoadingHandler[]>([]);
  // useEffect(() => {
  //   console.log("loading=", loading, resolveLoadingRef.current);
  //   if (!loading) {
  //     if (resolveLoadingRef.current.length) {
  //       const handlers = resolveLoadingRef.current;
  //       resolveLoadingRef.current = [];
  //       for (let handler of handlers) handler(true);
  //     }
  //   }
  // }, [loading]);

  useImperativeHandle(ref, () => {
    return {
      setUnready() {
        console.log('setUnready');
        ready$.current.next(false);
      },
      setReady() {
        console.log('setReady');
        // ready$.current.next(true);
      },
      ready(): Promise<boolean> {
        console.log("get Ready?", ready$.current, loading);
        return firstValueFrom(ready$.current.pipe(
          op.startWith(false),
          op.first((state: boolean) => state),
        ));
        // return new Promise((resolve, reject) => {
        //   
        //   if (loading) {
        //     resolveLoadingRef.current.push((state: boolean) => {
        //       console.log("resolve: ready, loading = ", loading);
        //       resolve(state);
        //     });
        //   }
        //   else resolve(true);
        // });
      },
      getSVGData() {
        return Promise.all(vegaRefs.current.map(view => view.toSVG()));
      },
      async getCanvasData() {
        const canvases = await Promise.all(vegaRefs.current.map(view => view.toCanvas()));
        return canvases.map(canvas => canvas.toDataURL('image/png'));
      },
      async downloadSVG(filename = `gw chart ${Date.now() % 1_000_000}`.padStart(6, '0')) {
        const data = await Promise.all(vegaRefs.current.map(view => view.toSVG()));
        const files: string[] = [];
        for (let i = 0; i < data.length; i += 1) {
          const d = data[i];
          const file = new File([d], `${filename}${data.length > 1 ? `_${i + 1}` : ''}.svg`);
          const url = URL.createObjectURL(file);
          const a = document.createElement('a');
          a.download = file.name;
          a.href = url;
          a.click();
          requestAnimationFrame(() => {
            URL.revokeObjectURL(url);
          });
        }
        return files;
      },
      async downloadPNG(filename = `gw chart ${Date.now() % 1_000_000}`.padStart(6, '0')) {
        const canvases = await Promise.all(vegaRefs.current.map(view => view.toCanvas(2)));
        const data = canvases.map(canvas => canvas.toDataURL('image/png', 1));
        const files: string[] = [];
        for (let i = 0; i < data.length; i += 1) {
          const d = data[i];
          const a = document.createElement('a');
          a.download = `${filename}${data.length > 1 ? `_${i + 1}` : ''}.png`;
          a.href = d.replace(/^data:image\/[^;]/, 'data:application/octet-stream');
          a.click();
        }
        return files;
      },
    };
  });

  return <CanvaContainer rowSize={Math.max(rowRepeatFields.length, 1)} colSize={Math.max(colRepeatFields.length, 1)}>
    {/* <div ref={container}></div> */}
    {
      viewPlaceholders.map((view, i) => <div key={i} ref={view}></div>)
    }
  </CanvaContainer>
});

export default ReactVega;
