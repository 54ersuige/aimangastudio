import { Router } from 'express';
import crudRouter from './series-routes/crud.js';
import worldviewRouter from './series-routes/worldview.js';
import charactersRouter from './series-routes/characters.js';
import chaptersRouter from './series-routes/chapters.js';
import pagesRouter from './series-routes/pages.js';

const router = Router();
router.use(crudRouter);
router.use(worldviewRouter);
router.use(charactersRouter);
router.use(chaptersRouter);
router.use(pagesRouter);

export default router;
