(() => {
    'use strict';

    const PER_PAGE = 30;
    const form = document.querySelector('#search-form');
    const qInput = document.querySelector('#q');
    const numberInput = document.querySelector('#product_number');
    const seriesSelect = document.querySelector('#series_id');
    const subseriesSelect = document.querySelector('#subseries');
    const rangeSelect = document.querySelector('#no_range');
    const resetButton = document.querySelector('#reset-button');
    const errorElement = document.querySelector('#form-error');
    const listElement = document.querySelector('#product-list');
    const countElement = document.querySelector('#catalog-count');
    const headingElement = document.querySelector('#result-heading');
    const summaryElement = document.querySelector('#result-summary');
    const pagerTop = document.querySelector('#pager-top');
    const pagerBottom = document.querySelector('#pager-bottom');

    let catalog = null;

    const normalize = (value) => String(value ?? '').toLocaleLowerCase('ja-JP');

    function splitKeywords(value) {
        const trimmed = value.trim();
        if (!trimmed) return [];
        if ([...trimmed].length > 200) throw new Error('フリーワードは200文字以内で入力してください。');
        const words = [...new Set(trimmed.split(/[\s\u3000]+/u).filter(Boolean))];
        if (words.length > 10) throw new Error('フリーワードは10語以内で入力してください。');
        if (words.some((word) => [...word].length > 50)) throw new Error('フリーワードは1語50文字以内で入力してください。');
        return words.map(normalize);
    }

    function currentParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            q: params.get('q') ?? '',
            productNumber: (params.get('product_number') ?? '').trim(),
            seriesId: Number.parseInt(params.get('series_id') ?? '', 10) || null,
            subseriesId: Number.parseInt(params.get('subseries') ?? '', 10) || null,
            noRange: params.get('no_range') ?? '',
            page: Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1),
        };
    }

    function seriesById(id) {
        return catalog.series.find((series) => series.id === id) ?? null;
    }

    function populateSeries() {
        for (const series of catalog.series) {
            const option = document.createElement('option');
            option.value = String(series.id);
            option.textContent = series.label;
            seriesSelect.append(option);
        }
    }

    function populateDependentFilters(series, requestedSubseries = '', requestedRange = '') {
        subseriesSelect.replaceChildren();
        rangeSelect.replaceChildren();

        if (!series) {
            subseriesSelect.disabled = true;
            rangeSelect.disabled = true;
            subseriesSelect.add(new Option('シリーズを選択すると利用できます', ''));
            rangeSelect.add(new Option('シリーズを選択すると利用できます', ''));
            return;
        }

        if (series.supports_subseries && series.subseries.length > 0) {
            subseriesSelect.disabled = false;
            subseriesSelect.add(new Option('すべて', ''));
            for (const subseries of series.subseries) {
                subseriesSelect.add(new Option(subseries.name, String(subseries.id)));
            }
            if ([...subseriesSelect.options].some((option) => option.value === String(requestedSubseries))) {
                subseriesSelect.value = String(requestedSubseries);
            }
        } else {
            subseriesSelect.disabled = true;
            subseriesSelect.add(new Option('このシリーズでは使用しません', ''));
        }

        if (series.supports_no_range && Number.isInteger(series.min_no) && Number.isInteger(series.max_no)) {
            rangeSelect.disabled = false;
            rangeSelect.add(new Option('指定なし', ''));
            for (let start = series.min_no; start <= series.max_no; start += 10) {
                const end = Math.min(start + 9, series.max_no);
                const digits = Math.max(0, series.range_digits);
                const startLabel = digits ? String(start).padStart(digits, '0') : String(start);
                const endLabel = digits ? String(end).padStart(digits, '0') : String(end);
                rangeSelect.add(new Option(`No.${startLabel}～${endLabel}`, `${start}-${end}`));
            }
            if ([...rangeSelect.options].some((option) => option.value === requestedRange)) {
                rangeSelect.value = requestedRange;
            }
        } else {
            rangeSelect.disabled = true;
            rangeSelect.add(new Option('このシリーズでは使用しません', ''));
        }
    }

    function productSearchText(product) {
        return [
            product.product_name,
            product.real_car_info,
            product.subseries_name,
            product.maker_name,
            product.body_type_name,
            product.model_car_name,
            ...(product.categories ?? []),
            ...(product.gimmicks ?? []),
        ].map(normalize);
    }

    function filterProducts(params, keywords) {
        let rangeStart = null;
        let rangeEnd = null;
        const rangeMatch = params.noRange.match(/^(\d{1,3})-(\d{1,3})$/);
        if (rangeMatch) {
            rangeStart = Number.parseInt(rangeMatch[1], 10);
            rangeEnd = Number.parseInt(rangeMatch[2], 10);
        }

        return catalog.products.filter((product) => {
            if (params.seriesId && product.series_id !== params.seriesId) return false;
            if (params.subseriesId && product.subseries_id !== params.subseriesId) return false;
            if (params.productNumber && !normalize(product.product_number).startsWith(normalize(params.productNumber))) return false;
            if (rangeStart !== null && (product.main_no === null || product.main_no < rangeStart || product.main_no > rangeEnd)) return false;
            if (keywords.length > 0) {
                const fields = productSearchText(product);
                if (!keywords.every((keyword) => fields.some((field) => field.includes(keyword)))) return false;
            }
            return true;
        });
    }

    function paramsFromForm() {
        const params = new URLSearchParams();
        const q = qInput.value.trim();
        const productNumber = numberInput.value.trim();
        if (q) params.set('q', q);
        if (productNumber) params.set('product_number', productNumber);
        if (seriesSelect.value) params.set('series_id', seriesSelect.value);
        if (!subseriesSelect.disabled && subseriesSelect.value) params.set('subseries', subseriesSelect.value);
        if (!rangeSelect.disabled && rangeSelect.value) params.set('no_range', rangeSelect.value);
        return params;
    }

    function pageUrl(page) {
        const params = new URLSearchParams(window.location.search);
        if (page > 1) params.set('page', String(page)); else params.delete('page');
        const query = params.toString();
        return query ? `?${query}` : './';
    }

    function renderPager(target, page, totalPages) {
        target.replaceChildren();
        if (totalPages <= 1) return;
        const start = Math.max(1, page - 3);
        const end = Math.min(totalPages, page + 3);
        const items = [];
        if (page > 1) items.push(['‹', page - 1, '前のページ']);
        for (let current = start; current <= end; current++) items.push([String(current), current, `${current}ページ`]);
        if (page < totalPages) items.push(['›', page + 1, '次のページ']);

        for (const [label, targetPage, aria] of items) {
            if (targetPage === page) {
                const current = document.createElement('span');
                current.className = 'current';
                current.textContent = label;
                current.setAttribute('aria-current', 'page');
                target.append(current);
            } else {
                const link = document.createElement('a');
                link.href = pageUrl(targetPage);
                link.textContent = label;
                link.setAttribute('aria-label', aria);
                target.append(link);
            }
        }
    }

    function createProductCard(product) {
        const article = document.createElement('article');
        article.className = 'product-row';

        const imageBox = document.createElement('div');
        imageBox.className = 'product-image';
        if (product.image) {
            const image = document.createElement('img');
            image.src = `./${product.image}`;
            image.alt = product.product_name;
            image.loading = 'lazy';
            image.addEventListener('error', () => {
                imageBox.replaceChildren(document.createTextNode('画像なし'));
            });
            imageBox.append(image);
        } else {
            imageBox.textContent = '画像なし';
        }

        const info = document.createElement('div');
        const meta = document.createElement('div');
        meta.className = 'product-meta';
        const series = product.subseries_name ? `${product.series_name} / ${product.subseries_name}` : product.series_name;
        meta.textContent = product.product_number ? `${series} / ${product.product_number}` : series;

        const title = document.createElement('div');
        title.className = 'product-title';
        const link = document.createElement('a');
        link.href = `./products/${product.id}/`;
        link.textContent = product.product_name;
        title.append(link);
        info.append(meta, title);
        article.append(imageBox, info);
        return article;
    }

    function render() {
        const params = currentParams();
        errorElement.hidden = true;
        let keywords;
        try {
            keywords = splitKeywords(params.q);
        } catch (error) {
            errorElement.textContent = error.message;
            errorElement.hidden = false;
            keywords = [];
        }

        const selectedSeries = seriesById(params.seriesId);
        const products = errorElement.hidden ? filterProducts(params, keywords) : [];
        const totalPages = Math.max(1, Math.ceil(products.length / PER_PAGE));
        const page = Math.min(params.page, totalPages);
        const visible = products.slice((page - 1) * PER_PAGE, page * PER_PAGE);

        headingElement.textContent = selectedSeries
            ? `「${selectedSeries.name}」内の検索結果`
            : 'すべてのシリーズの検索結果';
        const queryLabel = params.q.trim() ? `「${params.q.trim()}」` : '指定なし';
        const numberLabel = params.productNumber ? `「${params.productNumber}」` : '指定なし';
        summaryElement.textContent = `検索語：${queryLabel} / 製品番号：${numberLabel} / 検索結果：${products.length} 件 / ${page} / ${totalPages} ページ`;

        listElement.replaceChildren();
        if (visible.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'summary';
            empty.textContent = '該当するデータがありません。';
            listElement.append(empty);
        } else {
            listElement.append(...visible.map(createProductCard));
        }
        renderPager(pagerTop, page, totalPages);
        renderPager(pagerBottom, page, totalPages);
    }

    function applyUrlToForm() {
        const params = currentParams();
        qInput.value = params.q;
        numberInput.value = params.productNumber;
        if (params.seriesId && seriesById(params.seriesId)) seriesSelect.value = String(params.seriesId);
        populateDependentFilters(seriesById(params.seriesId), params.subseriesId ?? '', params.noRange);
    }

    function submitForm() {
        const params = paramsFromForm();
        const query = params.toString();
        window.location.href = query ? `?${query}` : './';
    }

    async function initialize() {
        try {
            const response = await fetch('./data/catalog.json', { cache: 'no-cache' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            catalog = await response.json();
            countElement.textContent = Number(catalog.product_count).toLocaleString('ja-JP');
            populateSeries();
            applyUrlToForm();
            render();
        } catch (error) {
            errorElement.textContent = '公開データを読み込めませんでした。時間をおいて再度お試しください。';
            errorElement.hidden = false;
            summaryElement.textContent = 'データの読み込みに失敗しました。';
        }
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        try {
            splitKeywords(qInput.value);
            submitForm();
        } catch (error) {
            errorElement.textContent = error.message;
            errorElement.hidden = false;
        }
    });

    seriesSelect.addEventListener('change', () => {
        populateDependentFilters(seriesById(Number.parseInt(seriesSelect.value, 10) || null));
        submitForm();
    });
    subseriesSelect.addEventListener('change', submitForm);
    rangeSelect.addEventListener('change', submitForm);
    resetButton.addEventListener('click', () => { window.location.href = './'; });

    initialize();
})();

