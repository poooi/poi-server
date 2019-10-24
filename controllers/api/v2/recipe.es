import Router from '@koa/router'
import mongoose from 'mongoose'
import fetch from 'node-fetch'
import _ from 'lodash'

const router = Router()

const RecipeRecord = mongoose.model('RecipeRecord')

const appendOrSet = (object, path, value) => {
  const v = _.get(object, path)
  if (!value) {
    return
  }
  if (v) {
    _.setWith(object, path, _.sortBy(v.concat(value)), Object)
  } else {
    _.setWith(object, path, [value], Object)
  }
}

const verifyOrSet = (object, path, value) => {
  const v = _.get(object, path)
  if (typeof v === 'undefined') {
    _.setWith(object, path, value, Object)
  } else if (v !== value) {
    throw new Error(`VerifyError, ${path}, ${value}, ${v}`)
  }
}

class Recipe {
  constructor(opts) {
    this.recipeId = Number(opts.recipeId)
    this.itemId = Number(opts.itemId)
    this.stage = Number(opts.stage)
    this.day = Number(opts.day)
    this.secretary = Number(opts.secretary)
    this.fuel = Number(opts.fuel)
    this.ammo = Number(opts.ammo)
    this.steel = Number(opts.steel)
    this.bauxite = Number(opts.bauxite)
    this.reqItemId = Number(opts.reqItemId)
    this.reqItemCount = Number(opts.reqItemCount)
    this.buildkit = Number(opts.buildkit)
    this.remodelkit = Number(opts.remodelkit)
    this.certainBuildkit = Number(opts.certainBuildkit)
    this.certainRemodelkit = Number(opts.certainRemodelkit)
    this.upgradeToItemId = Number(opts.upgradeToItemId)
    this.upgradeToItemLevel = Number(opts.upgradeToItemLevel)
    this.key = String(opts.key)
  }

  get equality() {
    return `r${this.recipeId}-i${this.itemId}-s${this.stage}-d${this.day}-s${this.secretary}`
  }

  get identity() {
    return ({
      recipeId: this.recipeId,
      itemId: this.itemId,
      stage: this.stage,
      day: this.day,
      secretary: this.secretary,
      fuel: this.fuel,
      ammo: this.ammo,
      steel: this.steel,
      bauxite: this.bauxite,
      reqItemId: this.reqItemId,
      reqItemCount: this.reqItemCount,
      buildkit: this.buildkit,
      remodelkit: this.remodelkit,
      certainBuildkit: this.certainBuildkit,
      certainRemodelkit: this.certainRemodelkit,
      upgradeToItemId: this.upgradeToItemId,
      upgradeToItemLevel: this.upgradeToItemLevel,
    })
  }

  get cost() {
    return ({
      fuel: this.fuel,
      ammo: this.ammo,
      steel: this.steel,
      bauxite: this.bauxite,
      reqItemId: this.reqItemId,
      reqItemCount: this.reqItemCount,
      buildkit: this.buildkit,
      remodelkit: this.remodelkit,
      certainBuildkit: this.certainBuildkit,
      certainRemodelkit: this.certainRemodelkit,
    })
  }
}

router.get('/api/recipe/full', async (ctx, next) => {
  try {
    if (await ctx.cashed()) {
      return
    }
    const allRecipes = await RecipeRecord.find().execAsync()

    const recipes = _.uniqWith(
    allRecipes.filter(datum => datum.stage !== -1)
    .map(datum => new Recipe(datum)), (a, b) => a.equality === b.equality)

    const res = {}

    _.each(recipes, (recipe) => {
      const commonPath = [recipe.itemId, 'common']
      _.each(['fuel', 'ammo', 'steel', 'bauxite'], key =>
        verifyOrSet(res, [...commonPath, key], recipe[key])
      )
      const basePath = (recipe.stage === 2 && recipe.upgradeToItemId > 0)
        ? [recipe.itemId, 'stage', recipe.stage, recipe.secretary, recipe.upgradeToItemId].map(num => String(num))
        : [recipe.itemId, 'stage', recipe.stage, recipe.secretary].map(num => String(num))
      _.each(['reqItemId', 'reqItemCount', 'buildkit', 'remodelkit',
        'certainBuildkit', 'certainRemodelkit'], key =>
        verifyOrSet(res, [...basePath, key], recipe[key])
      )
      if (recipe.stage === 2) {
        verifyOrSet(res, [...basePath, 'upgradeToItemLevel'], recipe.upgradeToItemLevel)
      }
      appendOrSet(res, [...basePath, 'day'], recipe.day)
    })

    ctx.status = 200
    ctx.body = {
      time: +new Date(),
      count: recipes.length,
      recipes: res,
    }
  } catch (err) {
    ctx.status = 500
    ctx.body = {
      error: err.message,
    }
  } finally {
    await next()
  }
})

router.get('/api/recipe/start2', async (ctx, next) => {
  try {
    if (await ctx.cashed()) {
      return
    }

    const res = await fetch('http://api.kcwiki.moe/start2')
    const data = await res.json()

    ctx.status = 200
    ctx.body = {
      time: +new Date(),
      data,
    }
  } catch (err) {
    ctx.status = 500
    ctx.body = {
      error: err.message,
    }
  } finally {
    await next()
  }
})

export default (app) => {
  app.use(router.routes())
}
