import { Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt.guard'

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  @Get()
  list() {}

  @Get(':id')
  findOne(@Param('id') id: string) {}

  @Post()
  create() {}

  @Delete(':id')
  remove(@Param('id') id: string) {}
}
