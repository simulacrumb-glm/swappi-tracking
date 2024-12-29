import { ERC20Processor } from '@sentio/sdk/eth/builtin'
import { getERC20Contract } from '@sentio/sdk/eth/builtin/erc20'
import { getPriceByType,  getPriceBySymbol, token } from "@sentio/sdk/utils"
import { BigDecimal, Counter, Gauge, MetricOptions } from "@sentio/sdk"
import { EthChainId } from "@sentio/sdk/eth"

import { SwappiFactoryProcessor } from "./types/eth/swappifactory.js"
import {
    BurnEvent,
    MintEvent,
    SwapEvent,
    SwappiPairContext,
    SwappiPairProcessor,
} from './types/eth/swappipair.js'


//const startBlock = 83066212 // ~Nov 4 83066212
const startBlock = 90000000

const SwappiFactoryAddress = "0xe2a6f7c0ce4d5d300f97aa7e125455f5cd3342f5"


const pools = [
    "0x8fCf9c586D45ce7Fcf6d714CB8b6b21a13111e0B",
    // "0x0736b3384531cda2f545f5449e84c6c6bcd6f01b",
    // "0x5767D71b462464fF77F6FBC81B8377aD49983511",
    // "0x8ea70966e8F14337657BFF7f40cFB9648f79530b",
    // "0x8BBBd6150C933fcd790B4a00baB23826912c192c",
    // "0xa6943647F22Cb9De7a80D1f447dB48B0209a812A",
    // "0x9B2e43277238d4C6a9534CAA84cf80cB076810eA",
    // "0x1112A6c61A2eeC4bD3Aec78bd5Bf3396bdd37D57",
    // "0x8a61e6cd8eeb564ff66459a2614ce98177f48ca9",
    // "0x2ddf0a20b99ad70aee0760f476c24a6568216ed4",
    // "0xa5dcd75c853dad730bef4ece3d20f0be7e297a6a",
    // "0x4812be910bd44d0320f5966ba0e6941a7aaeccc8",
    // "0xd9d5748cb36a81fe58f91844f4a0412502fd3105",
    // "0x157d7fccf8067eb1444c5d57b063b1f1d8c903ad",
    // "0x949b78ef2c8d6979098e195b08f27ff99cb20448",
    // "0x700d841e087f4038639b214e849beab622f178c6",
    // "0xb26cf61ade2cef606c798c396b6ed82a655361e8",
    // "0x31e6ef78c73db56aab43109d50249cab1b0635ef",
    // "0x1a381114c948b5fc20f23702d8411ef837ca7f1d",
    // "0xd3c067f9a54d4e2def17e1e827b200bde04af204",
    // "0xa98b140e5612bcabcc089609d910edb31abadeaa",
    // "0x1e4d8e1c0a82c6e2beadf28c3348e1afcd65234a",
    // "0xbceb03d464f0cecd9d2409e7d7514d18f78afd7a",
    // "0x267698dbadc9347b8bbd78d1972cd8614c4bac83",
    // "0x93d4be3c0b11fe52818cd96a5686db1e21d749ce",
    // "0x4f2fb607ffcf336bd2936d49399f974619412aaf",
]



async function getTokenInfo(ctx: SwappiPairContext, address: string): Promise<token.TokenInfo> {
    if (address !== "0x0000000000000000000000000000000000000000") {
        return await token.getERC20TokenInfo(ctx,address)
    } else {
        return token.NATIVE_ETH
    }
}

export const gaugeOptions: MetricOptions = {
    sparse: true,
    aggregationConfig: {
        intervalInMinutes: [60],
    }
}

interface poolInfo {
    token0: token.TokenInfo
    token1: token.TokenInfo
    token0Address: string
    token1Address: string
    realTimePrice: number
}
let poolInfoMap = new Map<string, Promise<poolInfo>>()
let priceMap = new Map<string, number>()

// too expensive
//export const vol = Gauge.register("vol", gaugeOptions)

async function buildPoolInfo(ctx: SwappiPairContext): Promise<poolInfo> {
    const address0 = await ctx.contract.token0()
    const address1 = await ctx.contract.token1()
    const tokenInfo0 = await getTokenInfo(ctx, address0)
    const tokenInfo1 = await getTokenInfo(ctx, address1)
    return {
        token0: tokenInfo0,
        token1: tokenInfo1,
        token0Address: address0,
        token1Address: address1,
        realTimePrice: 0,
    }
}

const getOrCreatePool = async function (ctx: SwappiPairContext) :Promise<poolInfo> {
    let infoPromise = poolInfoMap.get(ctx.address)
    if (!infoPromise) {
        infoPromise = buildPoolInfo(ctx)
        poolInfoMap.set(ctx.address, infoPromise)
        console.log("set poolInfoMap for " + ctx.address)
    }
    return await infoPromise
}

async function getToken(ctx: SwappiPairContext, info: token.TokenInfo, address :string, amount: bigint):
    Promise<[BigDecimal, BigDecimal]> {
    let scaledAmount = amount.scaleDown(info.decimal)
    const price = await getPriceByType(EthChainId.CONFLUX, address, ctx.timestamp) || 0
    return [scaledAmount, scaledAmount.multipliedBy(price)]
}

async function getTokenBySymbol(ctx: SwappiPairContext, info: token.TokenInfo, amount: bigint):
    Promise<[BigDecimal, BigDecimal]> {
    let scaledAmount = amount.scaleDown(info.decimal)
    const price = await getPriceBySymbol(info.symbol, ctx.timestamp) || 0
    return [scaledAmount, scaledAmount.multipliedBy(price)]
}

const poolName = function(token0 :string, token1:string) {
    return token0 + "/" + token1
}

interface priceDiff{
    priceDiff: number
    exchangePool: string
}


for (let i=0;i<pools.length; i++){
    let address=pools[i]
    SwappiPairProcessor.bind({
        address: address,
        network: EthChainId.CONFLUX,
        startBlock: startBlock
    }).onEventSwap(async function(event: SwapEvent, ctx: SwappiPairContext) {
        let info = await getOrCreatePool(ctx)
        let name = poolName(info.token0.symbol, info.token1.symbol)

        if(event.args.amount0In > 0){ 
            var zeroForOne = true
            //original using getToken, not setup for Conflux as per Sentio support
            // var [token0Amount, token0Price] = await getToken(ctx, info.token0, info.token0Address, event.args.amount0In)
            // var [token1Amount, token1Price] = await getToken(ctx, info.token1, info.token1Address, event.args.amount1Out)
            var [token0Amount, token0Price] = await getTokenBySymbol(ctx, info.token0, event.args.amount0In)
            var [token1Amount, token1Price] = await getTokenBySymbol(ctx, info.token1, event.args.amount1Out)
            var tokenInAmount = token0Amount
            var tokenOutAmount = token1Amount
            var mess = "swap " + token0Amount.abs().toString() + " " +
                    info.token0.symbol + " for " + token1Amount.abs().toString() + " " + info.token1.symbol
        }else{
            var zeroForOne = false
            var [token0Amount, token0Price] = await getTokenBySymbol(ctx, info.token0, event.args.amount0Out)
            var [token1Amount, token1Price] = await getTokenBySymbol(ctx, info.token1, event.args.amount1In)
            var tokenInAmount = token1Amount
            var tokenOutAmount = token0Amount
            var mess = "swap " + token1Amount.abs().toString() + " " +
                    info.token1.symbol + " for " + token0Amount.abs().toString() + " " + info.token0.symbol
        }
        
        // vol.record(ctx,
        //     token0Price.abs(),
        //     {
        //         poolName: name,
        //         type: "swap",
        //         zeroForOne: zeroForOne.toString(),
        //     }
        // )

        ctx.eventLogger.emit("Swap",
            {
                poolName: name,
                distinctId: ctx.transaction?.from,
                to: event.args.to,
                token0Amount: token0Amount,
                token1Amount: token1Amount,
                amount: token0Price,
                zeroForOne: zeroForOne,
                message: mess,
            }
        )
        // ctx.meter.Counter("total_tokens").add(token0Amount,
        //     {token: info.token0.symbol, poolName: name})
        // ctx.meter.Counter("total_tokens").add(token1Amount,
        //     {token: info.token1.symbol, poolName: name})
    },undefined,
    {
        transaction: true,
    }).onEventBurn(async function (event: BurnEvent, ctx: SwappiPairContext) {
        let info = await getOrCreatePool(ctx)
        let [token0Amount, token0Price] = await getTokenBySymbol(ctx, info.token0, event.args.amount0)
        let [token1Amount, token1Price] = await getTokenBySymbol(ctx, info.token1, event.args.amount1)
        let name = poolName(info.token0.symbol, info.token1.symbol)
        let total = token0Price.abs().plus(token1Price.abs())
        // vol.record(ctx,
        //     total,
        //     {
        //         poolName: name,
        //         type: "burn",
        //     }
        // )
        ctx.eventLogger.emit("Burn",
            {
                distinctId: event.args.sender,
                poolName: name,
                amount: total,
                message: "burn " + token0Amount.abs().toString() +
                    " " + info.token0.symbol + " and " +
                    token1Amount.abs().toString() + " " + info.token1.symbol,
            })
        // ctx.meter.Counter("total_tokens").sub(token0Amount,
        //     {token: info.token0.symbol, poolName: name})
        // ctx.meter.Counter("total_tokens").sub(token1Amount,
        //     {token: info.token1.symbol, poolName: name})
    }).onEventMint(async function (event: MintEvent, ctx: SwappiPairContext) {
        let info = await getOrCreatePool(ctx)
        let [token0Amount, token0Price] = await getTokenBySymbol(ctx, info.token0, event.args.amount0)
        let [token1Amount, token1Price] = await getTokenBySymbol(ctx, info.token1, event.args.amount1)
        let name = poolName(info.token0.symbol, info.token1.symbol)
        let total = token0Price.abs().plus(token1Price.abs())
        // vol.record(ctx,
        //     total,
        //     {
        //         poolName: name,
        //         type: "mint",
        //     }
        // )
        ctx.eventLogger.emit("Mint", {
            distinctId: event.args.sender,
            poolName: name,
            amount: total,
            message: "mint " +
                token0Amount.abs().toString() + " " +
                info.token0.symbol + " and " +
                token1Amount.abs().toString() + " " + info.token1.symbol,
        })
        // ctx.meter.Counter("total_tokens").add(token0Amount,
        //     {token: info.token0.symbol, poolName: name})
        // ctx.meter.Counter("total_tokens").add(token1Amount,
        //     {token: info.token1.symbol, poolName: name})
    })
}

SwappiFactoryProcessor.bind({ 
    address: SwappiFactoryAddress, 
    network: EthChainId.CONFLUX,
    startBlock: startBlock
}).onEventPairCreated(async (event, ctx) => {
    ctx.meter.Counter("cumulative_pairs").add(1);
    ctx.eventLogger.emit("PairCreated", {
      token0: event.args.token0,
      token1: event.args.token1,
      pair: event.args.pair
    })
  })



// too expensive to scale
// ERC20Processor.bind({
//  address: '0xfe97e85d13abd9c1c33384e796f10b73905637ce',
//   network: EthChainId.CONFLUX,
//   startBlock: startBlock
// }).onEventTransfer((event, ctx) => {
//     ctx.meter.Counter('token').add(event.args.value.scaleDown(18))
//   }
// )




// filter example
// const filter = ERC20Processor.filters.Transfer(
//   '0x0000000000000000000000000000000000000000',
//   '0xb329e39ebefd16f40d38f07643652ce17ca5bac1'
// )

// ERC20Processor.bind({ address: '0x1e4ede388cbc9f4b5c79681b7f94d36a11abebc9' }).onEventTransfer(
//   async (event, ctx) => {
//     const val = event.args.value.scaleDown(18)
//     tokenCounter.add(ctx, val)
//   },
//   filter // filter is an optional parameter
// )

// VaultProcessor.bind({
//   address: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
//   startBlock: 51976090,
//   network: EthChainId.POLYGON,
// }).onEventSwap(
//   async (evt, ctx) => {
//     // console.log("has event", ctx.blockNumber)
//     try {
//       let [tokens, reserves, lastChangeBlock] =
//         await ctx.contract.getPoolTokens(evt.args.poolId, {
//           blockTag: ctx.blockNumber,
//           chainId: EthChainId.POLYGON,
//         });
//       ctx.eventLogger.emit("Swap", {
//         distinctId: evt.args.poolId,
//         tokenIn: evt.args.tokenIn,
//         tokenOut: evt.args.tokenOut,
//         txnTo: ctx.transaction!.to,
//         poolID: evt.args.poolId,
//       });
//     } catch (e) {
//       // ctx.contract.provider.
//       console.log(ctx.blockNumber, e);
//       throw e;
//     }
//   },
//   undefined,
//   {
//     transaction: true,
//   }
// );